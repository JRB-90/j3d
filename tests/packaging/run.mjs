// The packaging check (D268, R31, R33): packs @j3d/occt and @j3d/viewer, installs the viewer's tarball
// from a URL, as a project does from a release (D254), builds this app with Vite and with webpack, in
// development and for production, with no J3D-specific configuration, and runs each in headless Chromium.
//
//   npm install && npm test              everything
//   npm test -- webpack                  only the targets whose name has that word

import { execSync, spawn } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { drawnShare, here, launch, repo, serve, startProcess, waitForServer, watchProblems } from './harness.mjs';

const only = process.argv[2];
const packPort = 5399;
const packed = join(here, 'packed');
const fixtures = ['assembly.step', 'box.brep', 'part.stl', 'draco.glb', 'ktx2.glb', 'meshopt.glb'];

function assert(condition, message, failures) {
  if (!condition) {
    failures.push(message);
  }
}

async function check(page, url) {
  const failures = [];
  const problems = watchProblems(page);

  await page.goto(url);
  await page.waitForFunction(() => window.__packaging?.ready === true, null, { timeout: 120_000 });
  const report = await page.evaluate(() => window.__packaging);

  assert(report.failed.length === 0, `imports failed: ${report.failed.join('; ')}`, failures);
  assert(report.loaded.length === fixtures.length, `loaded ${report.loaded.length} of ${fixtures.length}`, failures);
  assert(report.capabilities.webGl2, "the browser has no WebGL2, so nothing was drawn", failures);
  assert(report.styles.host === 'relative' && report.styles.home === 'absolute' && report.styles.labels === 'absolute', `the viewer's own styles didn't apply: ${JSON.stringify(report.styles)}`, failures);
  assert(report.controls.first.every(Boolean), `a default viewer lacks a control: ${report.controls.first}`, failures);
  assert(!report.controls.second.some(Boolean), `a viewer without controls has one: ${report.controls.second}`, failures);
  assert(report.scenes.first === 'unavailable', `a viewer that didn't ask to keep models has a store: ${report.scenes.first}`, failures);
  assert(report.scenes.second === 'kept', `a viewer that asked to keep models has none: ${report.scenes.second}`, failures);

  // Drawn: the first viewer's five models on its transparent canvas, against the page behind it.
  const first = page.locator('#first');
  const second = page.locator('#second');
  await page.waitForTimeout(500);
  const share = await drawnShare(page, await first.screenshot());
  assert(share > 0.01, `the first viewer drew almost nothing (${(share * 100).toFixed(2)}% of its pixels)`, failures);

  // Keys: the first viewer never asked; the second acts only with the pointer over it (D256).
  await first.hover();
  await page.keyboard.press('h');
  await second.hover();
  await page.keyboard.press('h');
  const afterKeys = await page.evaluate(() => window.__packaging.commands);
  assert(afterKeys.first.length === 0, `keys reached a viewer that didn't ask for them: ${afterKeys.first}`, failures);
  assert(afterKeys.second.length === 1, `the second viewer took ${afterKeys.second.length} commands for one key with the pointer over it`, failures);

  // A click on the box at the middle of its fitted view (D259).
  const box = await second.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__packaging.picks.length > 0, null, { timeout: 30_000 }).catch(() => {});
  const picks = await page.evaluate(() => window.__packaging.picks);
  assert(picks[0]?.node >= 0, `a click on the part picked ${JSON.stringify(picks[0] ?? 'nothing')}`, failures);

  // Each store is its own folder, and a viewer that didn't ask keeps nothing (D256).
  const stores = await page.evaluate(async () => {
    const names = [];
    for await (const name of (await navigator.storage.getDirectory()).keys()) {
      names.push(name);
    }
    return names;
  });
  assert(stores.includes('packaging-check') && !stores.includes('j3d'), `the private file system holds ${JSON.stringify(stores)}`, failures);

  console.log(`drew ${(share * 100).toFixed(1)}% of the first viewer, keys ${JSON.stringify(afterKeys)}, picked ${JSON.stringify(picks[0] ?? null)}, stores ${JSON.stringify(stores)}`);
  [...new Set(problems)].forEach((problem) => failures.push(problem));
  return failures;
}

const targets = [
  { name: 'vite dev', url: 'http://127.0.0.1:5301/', start: () => startProcess('npx vite --port 5301 --strictPort --host 127.0.0.1') },
  {
    name: 'vite build',
    url: 'http://127.0.0.1:5302/',
    build: 'npx vite build --outDir dist-vite --emptyOutDir',
    start: () => startProcess('npx vite preview --outDir dist-vite --port 5302 --strictPort --host 127.0.0.1'),
  },
  { name: 'webpack dev', url: 'http://127.0.0.1:5303/', build: 'npx webpack --mode development', start: () => startProcess('npx webpack serve --mode development') },
  {
    name: 'webpack build',
    url: 'http://127.0.0.1:5304/',
    build: 'npx webpack --mode production',
    start: () => {
      cpSync(join(here, 'webpack-public'), join(here, 'dist-webpack'), { recursive: true });
      return serve(join(here, 'dist-webpack'), 5304);
    },
  },
];

execSync(`node "${join(repo, 'scripts', 'pack.mjs')}" --out "${packed}" --url http://127.0.0.1:${packPort} --npm-only`, { cwd: repo, stdio: 'inherit' });

// Not execSync: this process serves the tarballs npm is fetching.
const packServer = await serve(packed, packPort);
await new Promise((done, fail) => {
  const install = spawn(`npm install --no-save --no-audit --no-fund http://127.0.0.1:${packPort}/j3d-viewer-0.0.0.tgz`, { cwd: here, shell: true, stdio: 'inherit' });
  install.on('exit', (code) => (code === 0 ? done() : fail(new Error(`npm install failed: ${code}`))));
});
packServer.stop();

for (const folder of ['public/fixtures', 'webpack-public/fixtures']) {
  mkdirSync(join(here, folder), { recursive: true });
  fixtures.forEach((name) => copyFileSync(join(repo, 'tests', 'fixtures', name), join(here, folder, name)));
}

const browser = await launch(chromium);
let failed = false;
for (const target of targets.filter(({ name }) => !only || name.includes(only))) {
  console.log(`\n=== ${target.name}`);
  let server;
  const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  try {
    if (target.build) {
      // A build that reports an error fails here, even where a dev server would carry on past it (S6).
      execSync(`${target.build} 2>&1`, { cwd: here, encoding: 'utf8', maxBuffer: 1 << 26 });
    }
    server = await target.start();
    await waitForServer(target.url, server);
    const failures = await check(await context.newPage(), target.url);
    failures.forEach((failure) => console.log(`FAIL  ${failure}`));
    console.log(failures.length === 0 ? 'PASS' : `${failures.length} failed`);
    failed ||= failures.length > 0;
  } catch (error) {
    console.log(`FAIL  ${String(error.stdout ?? error.message).slice(-3000)}`);
    failed = true;
  } finally {
    server?.stop();
    await context.close();
  }
}
await browser.close();
rmSync(packed, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
