// The real assembly for manual checks and the large-model tests (D156, D160): the SO-101 robot arm
// from TheRobotStudio/SO-ARM100 (Apache-2.0), pinned to one commit and checked against its SHA-256.
// Downloaded on demand into tests/fixtures/large/so101.step (git-ignored); never committed or shipped.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const Commit = 'd04fa975fb79c9870df5824cce7c7390d52cac85';
const Url = `https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/${Commit}/STEP/SO101/SO101%20Assembly.step`;
const Sha256 = 'f754be35708382b05ce65768ae33c612f91dca11ad19d14807dc637eb944ba3d';

const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Downloads the SO-101 assembly to `path`, unless a copy with the right hash is already there. */
export async function downloadSo101(path) {
  if (existsSync(path) && hashOf(readFileSync(path)) === Sha256) {
    console.log(`${path}: already downloaded`);
    return;
  }
  const response = await fetch(Url);
  if (!response.ok) {
    throw new Error(`Downloading the SO-101 assembly failed: HTTP ${response.status} from ${Url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = hashOf(bytes);
  if (hash !== Sha256) {
    throw new Error(`The SO-101 assembly's SHA-256 is ${hash}, not the pinned ${Sha256}.`);
  }
  writeFileSync(path, bytes);
  console.log(`${path}: ${(bytes.length / 1e6).toFixed(1)} MB (SO-ARM100 at ${Commit.slice(0, 7)}, Apache-2.0)`);
}
