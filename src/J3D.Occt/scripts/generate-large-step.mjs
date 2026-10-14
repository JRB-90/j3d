// Generates large STEP files for the memory-ceiling spike (S2) and the on-demand large-model tests.
// They are never committed (tests/fixtures/large/ is git-ignored).
//
//   npm run fixtures:large                 # 200 MB
//   npm run fixtures:large -- 25 50 100    # one file per size, in MB
//
// Each file repeats tests/fixtures/coloured-part.step (written by OCCT, so known to be valid) as
// separate top-level parts: entity ids are renumbered and 3D points offset onto a grid, so every copy
// is distinct geometry. That is the worst case for parsing and meshing memory: thousands of unique
// parts and no instancing.

import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const template = readFileSync(`${fixtures}coloured-part.step`, 'latin1');

const dataStart = template.indexOf('DATA;') + 'DATA;'.length;
const header = template.slice(0, dataStart);
const data = template.slice(dataStart, template.indexOf('ENDSEC;', dataStart));
const idSpan = Math.max(...[...data.matchAll(/#(\d+)/g)].map((match) => Number(match[1])));
const spacing = 100; // mm between parts; the template part is 40 × 30 × 20

/** One copy of the template part: ids shifted by `copy × idSpan`, points moved to its grid cell. */
function copyOf(copy, columns) {
  const dx = (copy % columns) * spacing;
  const dy = Math.floor(copy / columns) * spacing;
  return data
    .replace(/#(\d+)/g, (_, id) => `#${Number(id) + copy * idSpan}`)
    .replace(/CARTESIAN_POINT\('',\(([^,()]+),([^,()]+),([^,()]+)\)\)/g, (_, x, y, z) =>
      `CARTESIAN_POINT('',(${format(Number(x) + dx)},${format(Number(y) + dy)},${z}))`,
    )
    .replace(/PRODUCT\('Coloured block','Coloured block'/g, `PRODUCT('Block ${copy + 1}','Block ${copy + 1}'`);
}

const format = (value) => (Number.isInteger(value) ? `${value}.` : String(value));

async function generate(megabytes) {
  const target = megabytes * 1_000_000;
  const columns = Math.ceil(Math.sqrt(target / data.length));
  const path = `${fixtures}large/large-${megabytes}mb.step`;
  mkdirSync(`${fixtures}large`, { recursive: true });

  const out = createWriteStream(path, { encoding: 'latin1' });
  out.write(header);
  let written = header.length;
  let copies = 0;
  while (written < target) {
    const part = copyOf(copies++, columns);
    written += part.length;
    if (!out.write(part)) {
      await once(out, 'drain');
    }
  }
  out.end('ENDSEC;\nEND-ISO-10303-21;\n');
  await once(out, 'finish');
  console.log(`${path}: ${copies} parts, ${(out.bytesWritten / 1e6).toFixed(1)} MB`);
}

const sizes = process.argv.slice(2).map(Number);
for (const megabytes of sizes.length > 0 ? sizes : [200]) {
  if (!(megabytes > 0)) {
    throw new Error(`Not a size in MB: ${megabytes}`);
  }
  await generate(megabytes);
}
