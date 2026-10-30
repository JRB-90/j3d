// The samples' smoke test (D259, D285, R32): each sample, copied out of the repo so nothing of it leans on
// the repo, is installed as a project installs it and run on its production output in headless Chromium,
// where it loads a fixture and clicks a part.
//
//   node samples.mjs                                   packs, then tries those files
//   node samples.mjs --packed <folder> --version 0.1.0 tries files already packed: a release's, before it's public
//   node samples.mjs --release v0.1.0                  tries a published release from its public URLs (R33)
//   node samples.mjs ... vite                          only the samples whose name has that word

import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { drawnShare, launch, repo, startProcess, waitForServer, watchProblems } from './harness.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { packed: { type: 'string' }, version: { type: 'string' }, release: { type: 'string' } },
});
const only = positionals[0];
const Releases = 'https://github.com/JRB-90/j3d/releases/download';
const fixture = join(repo, 'tests', 'fixtures', 'assembly.step');
const Ready = 'Click a part to select it.';

const work = mkdtempSync(join(tmpdir(), 'j3d-samples-'));
const version = values.release?.replace(/^v/, '') ?? values.version ?? '0.0.0';
const releaseUrl = `${Releases}/v${version}`;

// From a release, or from local files, and those packed here unless named: their kernel URL is the release's,
// which doesn't exist yet, so the samples take the kernel from a local tarball through `overrides` (R33).
let packed = values.packed && resolve(values.packed);
if (!values.release && !packed) {
  packed = join(work, 'packed');
  execSync(`node "${join(repo, 'scripts', 'pack.mjs')}" --out "${packed}" --url ${releaseUrl} --version ${version}`, { cwd: repo, stdio: 'inherit' });
}

function copySample(name) {
  const folder = join(work, name);
  cpSync(join(repo, 'samples', name), folder, {
    recursive: true,
    filter: (source) => !['node_modules', 'dist', 'bin', 'obj', 'packages'].includes(basename(source)),
  });
  return folder;
}

function installVite() {
  const folder = copySample('vite');
  const path = join(folder, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.dependencies['@j3d/viewer'] = packed ? `file:${join(packed, `j3d-viewer-${version}.tgz`)}` : `${releaseUrl}/j3d-viewer-${version}.tgz`;
  if (packed) {
    manifest.overrides = { '@j3d/occt': `file:${join(packed, `j3d-occt-${version}.tgz`)}` };
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  execSync('npm install --no-audit --no-fund', { cwd: folder, stdio: 'inherit' });
  execSync('npm run build', { cwd: folder, stdio: 'inherit' });
  return startProcess('npx vite preview --port 5311 --strictPort --host 127.0.0.1', folder);
}

async function installBlazor() {
  const folder = copySample('blazor');
  const project = join(folder, 'BlazorSample.Client', 'BlazorSample.Client.csproj');
  writeFileSync(project, readFileSync(project, 'utf8').replace(/(Include="J3D\.Blazor" Version=")[^"]+/, `$1${version}`));

  const packages = join(folder, 'packages');
  mkdirSync(packages);
  const nupkg = `J3D.Blazor.${version}.nupkg`;
  if (packed) {
    copyFileSync(join(packed, nupkg), join(packages, nupkg));
  } else {
    const response = await fetch(`${releaseUrl}/${nupkg}`);
    if (!response.ok) {
      throw new Error(`${releaseUrl}/${nupkg} answered ${response.status}.`);
    }
    writeFileSync(join(packages, nupkg), Buffer.from(await response.arrayBuffer()));
  }

  // Its own package cache: one version of J3D.Blazor is kept per machine, so a stale copy would pass here.
  const env = { ...process.env, NUGET_PACKAGES: join(work, 'nuget') };
  const published = join(work, 'blazor-published');
  execSync(`dotnet publish BlazorSample -c Release -o "${published}"`, { cwd: folder, env, stdio: 'inherit' });
  return startProcess('dotnet BlazorSample.dll --urls http://127.0.0.1:5312', published);
}

async function smoke(browser, url, viewerSelector) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  const page = await context.newPage();
  const problems = watchProblems(page);
  try {
    await page.goto(url);

    // The viewer sets the input's `accept` once it has taken the input over.
    await page.waitForSelector('#files[accept]', { state: 'attached', timeout: 120_000 });
    await page.setInputFiles('#files', fixture);
    const status = page.locator('#status');
    await page.waitForFunction((ready) => document.querySelector('#status').textContent === ready, Ready, { timeout: 120_000 }).catch(async () => {
      throw new Error(`The model never loaded: the page says "${await status.textContent()}".`);
    });

    const viewer = page.locator(viewerSelector);
    await page.waitForTimeout(500);
    const share = await drawnShare(page, await viewer.screenshot());
    if (share < 0.01) {
      throw new Error(`The viewer drew almost nothing (${(share * 100).toFixed(2)}% of its pixels).`);
    }

    // A click on the part at the middle of the fitted view.
    const box = await viewer.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((ready) => document.querySelector('#status').textContent !== ready, Ready, { timeout: 30_000 }).catch(() => {
      throw new Error('A click on the part selected nothing.');
    });
    console.log(`drew ${(share * 100).toFixed(1)}% of the viewer, picked "${await status.textContent()}"`);

    // The sample fills its window, with the viewer in charge of what's inside it.
    const size = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, inner: window.innerHeight }));
    if (size.height > size.inner) {
      throw new Error(`The page scrolls: ${size.height} px in a ${size.inner} px window.`);
    }
    if (problems.length > 0) {
      throw new Error('The page reported problems.');
    }
  } catch (error) {
    error.message += `\n${[...new Set(problems)].join('\n')}`;
    throw error;
  } finally {
    await context.close();
  }
}

const samples = [
  { name: 'vite', url: 'http://127.0.0.1:5311/', viewer: '#viewer', install: installVite },
  { name: 'blazor', url: 'http://127.0.0.1:5312/', viewer: '.viewer', install: installBlazor },
];

const browser = await launch(chromium);
let failed = false;
for (const sample of samples.filter(({ name }) => !only || name.includes(only))) {
  console.log(`\n=== sample: ${sample.name}, ${packed ? `packed files of ${version}` : `release ${version}`}`);
  let server;
  try {
    server = await sample.install();
    await waitForServer(sample.url, server);
    await smoke(browser, sample.url, sample.viewer);
    console.log('PASS');
  } catch (error) {
    console.log(`FAIL  ${String(error.stdout ?? error.message).slice(-3000)}`);
    if (server) {
      console.log(server.log().slice(-1500));
    }
    failed = true;
  } finally {
    server?.stop();
  }
}
await browser.close();
if (failed) {
  console.log(`Left for a look: ${work}`);
} else {
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(failed ? 1 : 0);
