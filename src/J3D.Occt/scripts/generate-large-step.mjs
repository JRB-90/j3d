// Generates large STEP files for the memory-ceiling spike (S2), the threading spike (S4) and the
// on-demand large-model tests. They are never committed (tests/fixtures/large/ is git-ignored).
//
//   npm run fixtures:large                         # large-200mb.step
//   npm run fixtures:large -- 25 50 100            # one file per size, in MB
//   npm run fixtures:large -- --curved 25 100      # curved-25mb.step, curved-100mb.step
//   npm run fixtures:large -- 200 curved-100       # large-200mb.step, curved-100mb.step
//
//   npm run fixtures:large -- plant-10000                # plant-10000.step: a hierarchical assembly
//   npm run fixtures:large -- so101                      # so101.step: the real SO-101 arm, downloaded
//
// The same names (200, curved-100, plant-10000, so101) go in J3D_LARGE_FIXTURES for the large-model
// tests. Plants are written by OCCT (plant.mjs, which needs libcascade installed; see xcaf.mjs), with
// about as many parts as named; so101 is fetched at a pinned commit (so101.mjs).
//
// Each file repeats a template part written by OCCT (so known to be valid) as separate top-level
// parts: entity ids are renumbered and 3D points offset onto a grid, so every copy is distinct
// geometry. That is the worst case for parsing and meshing memory: thousands of unique parts and no
// instancing. The default template is tests/fixtures/coloured-part.step, a block that is heavy to
// parse and almost free to mesh; curved files use curved-part.step, whose filleted, lofted and
// drilled faces make meshing cost something (D62).

import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const templates = {
  block: { file: 'coloured-part.step', product: 'Coloured block', copyName: 'Block', output: 'large' },
  curved: { file: 'curved-part.step', product: 'Curved part', copyName: 'Curved part', output: 'curved' },
};

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const spacing = 100; // mm between parts; both template parts fit in 40 × 30 × 35

/** A template's header, data section and id range, read once. */
function load(kind) {
  const template = readFileSync(`${fixtures}${kind.file}`, 'latin1');
  const dataStart = template.indexOf('DATA;') + 'DATA;'.length;
  const data = template.slice(dataStart, template.indexOf('ENDSEC;', dataStart));
  return {
    ...kind,
    header: template.slice(0, dataStart),
    data,
    idSpan: Math.max(...[...data.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))),
    productPattern: new RegExp(`PRODUCT\\('${kind.product}','${kind.product}'`, 'g'),
  };
}

/** One copy of the template part: ids shifted by `copy × idSpan`, points moved to its grid cell. */
function copyOf({ data, idSpan, productPattern, copyName }, copy, columns) {
  const dx = (copy % columns) * spacing;
  const dy = Math.floor(copy / columns) * spacing;
  const name = `${copyName} ${copy + 1}`;
  return (
    data
      .replace(/#(\d+)/g, (_, id) => `#${Number(id) + copy * idSpan}`)
      // 3D points only (pcurves' 2D points are in parameter space). OCCT wraps long lines, so a
      // point's closing parenthesis can be on the next line.
      .replace(/CARTESIAN_POINT\('',\(([^,()]+),([^,()]+),([^,()]+)\)\s*\)/g, (_, x, y, z) =>
        `CARTESIAN_POINT('',(${format(Number(x) + dx)},${format(Number(y) + dy)},${z.trim()}))`,
      )
      .replace(productPattern, `PRODUCT('${name}','${name}'`)
  );
}

const format = (value) => (Number.isInteger(value) ? `${value}.` : String(value));

async function generate(template, megabytes) {
  const target = megabytes * 1_000_000;
  const columns = Math.ceil(Math.sqrt(target / template.data.length));
  const path = `${fixtures}large/${template.output}-${megabytes}mb.step`;
  mkdirSync(`${fixtures}large`, { recursive: true });

  const out = createWriteStream(path, { encoding: 'latin1' });
  out.write(template.header);
  let written = template.header.length;
  let copies = 0;
  while (written < target) {
    const part = copyOf(template, copies++, columns);
    written += part.length;
    if (!out.write(part)) {
      await once(out, 'drain');
    }
  }
  out.end('ENDSEC;\nEND-ISO-10303-21;\n');
  await once(out, 'finish');
  console.log(`${path}: ${copies} parts, ${(out.bytesWritten / 1e6).toFixed(1)} MB`);
}

/** A plant with at least `parts` parts, in lines of ten stations (D161). */
async function generatePlant(parts) {
  const [{ buildPlant, partsPerLine }, { loadOcct }] = await Promise.all([import('./plant.mjs'), import('./xcaf.mjs')]);
  const stations = 10;
  const lines = Math.max(1, Math.ceil(parts / partsPerLine(stations)));
  const path = `${fixtures}large/plant-${parts}.step`;
  mkdirSync(`${fixtures}large`, { recursive: true });
  const bytes = buildPlant(await loadOcct(), { lines, stations });
  writeFileSync(path, bytes);
  console.log(`${path}: ${lines * partsPerLine(stations)} parts, ${(bytes.length / 1e6).toFixed(1)} MB`);
}

const args = process.argv.slice(2);
const curved = args.includes('--curved');
const files = args.filter((arg) => arg !== '--curved');
const loaded = new Map();
for (const file of files.length > 0 ? files : ['200']) {
  if (file === 'so101') {
    mkdirSync(`${fixtures}large`, { recursive: true });
    const { downloadSo101 } = await import('./so101.mjs');
    await downloadSo101(`${fixtures}large/so101.step`);
    continue;
  }
  const plant = /^plant-(\d+)$/.exec(file);
  if (plant) {
    await generatePlant(Number(plant[1]));
    continue;
  }
  const [, prefix, size] = /^(curved-)?(.*)$/.exec(file);
  const megabytes = Number(size);
  if (!(megabytes > 0)) {
    throw new Error(`Not a size in MB, curved-<MB>, plant-<parts> or so101: ${file}`);
  }
  const kind = prefix || curved ? templates.curved : templates.block;
  if (!loaded.has(kind)) {
    loaded.set(kind, load(kind));
  }
  await generate(loaded.get(kind), megabytes);
}
