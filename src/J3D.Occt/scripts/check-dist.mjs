// Fails when the committed OCCT WebAssembly build (dist/) is stale, i.e. was not built from the
// current libcascade.config.ts and wrappers/*.cpp. Compares against the hashes the toolchain
// records in dist/*.provenance.json. Needs no container: the config is only rendered.
//
//   npm run check:dist --workspace @j3d/occt

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const renderDir = join(root, '.libcascade');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const toolchainDir = dirname(createRequire(import.meta.url).resolve('@libcascade/toolchain/package.json'));
execFileSync(process.execPath, [join(toolchainDir, 'bin', 'libcascade.mjs'), 'build', '--render-only'], {
  cwd: root,
  stdio: 'ignore',
});

const problems = [];
const provenanceFiles = existsSync(distDir) ? readdirSync(distDir).filter((name) => name.endsWith('.provenance.json')) : [];
if (provenanceFiles.length === 0) {
  problems.push('dist/ has no build. Run the "OCCT WASM" workflow or `npm run build:wasm`.');
}

for (const file of provenanceFiles) {
  const provenance = JSON.parse(readFileSync(join(distDir, file), 'utf8'));
  const variant = provenance.linking.yamlConfig.replace(/\.js$/, '');

  const renderedYml = join(renderDir, `${variant}.yml`);
  if (!existsSync(renderedYml)) {
    problems.push(`${variant}: variant no longer exists in libcascade.config.ts.`);
    continue;
  }
  if (!sha256(renderedYml).startsWith(provenance.linking.yamlConfigHash)) {
    problems.push(`${variant}: libcascade.config.ts changed since this build.`);
  }

  for (const source of provenance.linking.sourceFiles) {
    const path = resolve(renderDir, source.path);
    if (!existsSync(path)) {
      problems.push(`${variant}: ${source.path} no longer exists.`);
    } else if (sha256(path) !== source.sha256) {
      problems.push(`${variant}: ${source.path} changed since this build.`);
    }
  }
}

if (problems.length > 0) {
  console.error('OCCT WASM build in src/J3D.Occt/dist is stale:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('Rebuild with the "OCCT WASM" GitHub workflow, or locally with `npm run build:wasm --workspace @j3d/occt` (needs Docker).');
  process.exit(1);
}

console.log(`OCCT WASM build is up to date (${provenanceFiles.length} variant(s)).`);
