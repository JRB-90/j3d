// Builds the package into lib/ (D264): the TypeScript compiled to ES modules, with the Emscripten glue
// and the single-threaded WebAssembly beside it (D253).
//
//   npm run build --workspace @j3d/occt

import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
const lib = new URL('../lib/', import.meta.url);

rmSync(lib, { recursive: true, force: true });
execSync('tsc -p tsconfig.build.json', { cwd: root, stdio: 'inherit' });

copyFileSync(new URL('j3d_occt_single.wasm', dist), new URL('j3d_occt_single.wasm', lib));

// The glue's Node branch never runs in a browser, but a bundler follows the import and webpack can't
// read `node:` URLs (spike S6). Marked, every bundler leaves it for Node alone to run.
const glue = readFileSync(new URL('j3d_occt_single.js', dist), 'utf8');
const nodeImport = 'await import("node:module")';
if (glue.split(nodeImport).length !== 2) {
  throw new Error(`The glue should have one ${nodeImport}: has the toolchain changed?`);
}
writeFileSync(new URL('j3d_occt_single.js', lib), glue.replace(nodeImport, 'await import(/* webpackIgnore: true */ /* @vite-ignore */ "node:module")'));
