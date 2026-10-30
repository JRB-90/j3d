// Packs @j3d/occt and @j3d/viewer as tarballs (D253, D254): what goes on a release, and what
// tests/packaging installs.
//
//   node scripts/pack.mjs --out <folder> --url <where the tarballs will be> [--version 0.1.0]
//
// Each package's manifest is rewritten for its tarball: its development entries go, and the viewer's
// dependency on the kernel becomes the kernel tarball's URL, so npm never asks a registry for it.

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, openSync, readFileSync, readSync, closeSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' }, url: { type: 'string' }, version: { type: 'string', default: '0.0.0' } } });
if (!values.out || !values.url) {
  throw new Error('Usage: node scripts/pack.mjs --out <folder> --url <where the tarballs will be> [--version 0.1.0]');
}
const repo = resolve(import.meta.dirname, '..');
const out = resolve(values.out);
const baseUrl = values.url.replace(/\/$/, '');
const { version } = values;
const stageRoot = join(repo, 'artifacts', 'pack-stage');

const tarball = (name) => `j3d-${name}-${version}.tgz`;

/** An entry point as a tarball has it: the compiled files, without the workspace's sources. */
const released = ({ types, default: entry }) => ({ types, default: entry });

function manifest(folder, change) {
  const { name, description, license, type, sideEffects, exports, peerDependencies, dependencies } = JSON.parse(readFileSync(join(repo, folder, 'package.json'), 'utf8'));
  return change({
    name,
    version,
    description,
    license,
    repository: { type: 'git', url: 'git+https://github.com/JRB-90/j3d.git' },
    type,
    sideEffects,
    exports: Object.fromEntries(Object.entries(exports).filter(([, entry]) => entry['j3d-source']).map(([path, entry]) => [path, released(entry)])),
    files: ['lib'],
    ...(peerDependencies ? { peerDependencies } : {}),
    ...(dependencies ? { dependencies } : {}),
  });
}

function pack(name, folder, change = (package_) => package_) {
  const stage = join(stageRoot, name);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(join(repo, folder, 'lib'), join(stage, 'lib'), { recursive: true });
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest(folder, change), null, 2)}\n`);
  execSync(`npm pack --silent --pack-destination "${out}"`, { cwd: stage, stdio: ['ignore', 'ignore', 'inherit'] });
  return stage;
}

/** A checkout without `git lfs pull` holds a text pointer where the WASM should be (R33). */
function checkWasm(file) {
  const magic = Buffer.alloc(4);
  const handle = openSync(file, 'r');
  readSync(handle, magic, 0, 4, 0);
  closeSync(handle);
  if (magic.toString('latin1') !== '\0asm' || statSync(file).size < 1_000_000) {
    throw new Error(`${file} isn't the OCCT WebAssembly: run git lfs pull.`);
  }
}

execSync('npm run build --workspace @j3d/occt', { cwd: repo, stdio: 'inherit' });
execSync('npm run build --workspace @j3d/viewer', { cwd: repo, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const occt = pack('occt', 'src/J3D.Occt');
checkWasm(join(occt, 'lib', 'j3d_occt_single.wasm'));
pack('viewer', 'src/J3D.Viewer', (package_) => ({
  ...package_,
  dependencies: { ...package_.dependencies, '@j3d/occt': `${baseUrl}/${tarball('occt')}` },
}));
rmSync(stageRoot, { recursive: true, force: true });
console.log(`Packed ${tarball('occt')} and ${tarball('viewer')} into ${out}`);
