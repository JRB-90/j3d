// Generates large STEP files for the memory-ceiling spike (S2), the threading spike (S4) and the
// on-demand large-model tests. They are never committed (tests/fixtures/large/ is git-ignored).
//
//   npm run fixtures:large                         # large-200mb.step
//   npm run fixtures:large -- 25 50 100            # one file per size, in MB
//   npm run fixtures:large -- --curved 25 100      # curved-25mb.step, curved-100mb.step
//
// Each file repeats a template part written by OCCT (so known to be valid) as separate top-level
// parts: entity ids are renumbered and 3D points offset onto a grid, so every copy is distinct
// geometry. That is the worst case for parsing and meshing memory: thousands of unique parts and no
// instancing. The default template is tests/fixtures/coloured-part.step, a block that is heavy to
// parse and almost free to mesh; --curved uses curved-part.step, whose filleted, lofted and drilled
// faces make meshing cost something (D62).

import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const templates = {
  block: { file: 'coloured-part.step', product: 'Coloured block', copyName: 'Block', output: 'large' },
  curved: { file: 'curved-part.step', product: 'Curved part', copyName: 'Curved part', output: 'curved' },
};

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const args = process.argv.slice(2);
const kind = args.includes('--curved') ? templates.curved : templates.block;
const template = readFileSync(`${fixtures}${kind.file}`, 'latin1');

const dataStart = template.indexOf('DATA;') + 'DATA;'.length;
const header = template.slice(0, dataStart);
const data = template.slice(dataStart, template.indexOf('ENDSEC;', dataStart));
const idSpan = Math.max(...[...data.matchAll(/#(\d+)/g)].map((match) => Number(match[1])));
const spacing = 100; // mm between parts; both template parts fit in 40 × 30 × 35
const product = new RegExp(`PRODUCT\\('${kind.product}','${kind.product}'`, 'g');

/** One copy of the template part: ids shifted by `copy × idSpan`, points moved to its grid cell. */
function copyOf(copy, columns) {
  const dx = (copy % columns) * spacing;
  const dy = Math.floor(copy / columns) * spacing;
  const name = `${kind.copyName} ${copy + 1}`;
  return (
    data
      .replace(/#(\d+)/g, (_, id) => `#${Number(id) + copy * idSpan}`)
      // 3D points only (pcurves' 2D points are in parameter space). OCCT wraps long lines, so a
      // point's closing parenthesis can be on the next line.
      .replace(/CARTESIAN_POINT\('',\(([^,()]+),([^,()]+),([^,()]+)\)\s*\)/g, (_, x, y, z) =>
        `CARTESIAN_POINT('',(${format(Number(x) + dx)},${format(Number(y) + dy)},${z.trim()}))`,
      )
      .replace(product, `PRODUCT('${name}','${name}'`)
  );
}

const format = (value) => (Number.isInteger(value) ? `${value}.` : String(value));

async function generate(megabytes) {
  const target = megabytes * 1_000_000;
  const columns = Math.ceil(Math.sqrt(target / data.length));
  const path = `${fixtures}large/${kind.output}-${megabytes}mb.step`;
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

const sizes = args.filter((arg) => arg !== '--curved').map(Number);
for (const megabytes of sizes.length > 0 ? sizes : [200]) {
  if (!(megabytes > 0)) {
    throw new Error(`Not a size in MB: ${megabytes}`);
  }
  await generate(megabytes);
}
