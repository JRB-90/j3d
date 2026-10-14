// Spike S4 (D61): imports the same files with the single- and multi-threaded OCCT builds under Node
// and compares their times, phase by phase. Threading becomes the default only at >= 1.3x on the
// whole import on CI's 4-core runner (D28, D69).
//
//   npm run fixtures:large -- 25 100 && npm run fixtures:large -- --curved 25 100
//   npm run benchmark:threads --workspace @j3d/occt -- large/large-25mb.step large/curved-25mb.step
//   npm run benchmark:threads --workspace @j3d/occt -- --runs 5 assembly.step
//
// Paths are relative to tests/fixtures. Each import runs in a fresh Node process, as each model gets
// a fresh worker in the browser: the threaded build's pthread workers and heap would otherwise
// outlive the run. Instantiating the module isn't timed. Both builds must produce the same triangles.

import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const variants = ['single', 'multi'];
const phases = ['Reading', 'Parsing', 'Transferring', 'Meshing', 'Extracting'];
const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));

if (process.argv[2] === '--child') {
  await measure(process.argv[3], process.argv[4]);
} else {
  compare();
}

/** One import in this process; prints its timings as one JSON line. */
async function measure(variant, file) {
  const { OcctModel, ImportFormat } = await import(new URL('../src/facade.ts', import.meta.url).href);
  const { default: init } = await import(new URL(`../dist/j3d_occt_${variant}.js`, import.meta.url).href);
  const oc = await init();
  const bytes = new Uint8Array(readFileSync(`${fixtures}${file}`));
  const format = /\.(iges|igs)$/i.test(file) ? ImportFormat.Iges : /\.brep$/i.test(file) ? ImportFormat.Brep : ImportFormat.Step;

  const times = Object.fromEntries(phases.map((phase) => [phase, 0]));
  let [current, since] = [-1, 0];
  const start = performance.now();
  const model = await OcctModel.load(oc, bytes, format, file, {
    onProgress: (phase) => {
      if (phase !== current) {
        const now = performance.now();
        if (current >= 0) times[phases[current]] += now - since;
        [current, since] = [phase, now];
      }
    },
  });
  const end = performance.now();
  times[phases[current]] += end - since;
  const triangles = model.scene.prototypes.reduce((sum, prototype) => sum + prototype.indices.length / 3, 0);
  console.log(JSON.stringify({ total: end - start, times, triangles, heap: model.memoryBytes }));
  model.dispose();
  process.exit(0);
}

function compare() {
  const args = process.argv.slice(2);
  const runsAt = args.indexOf('--runs');
  const runs = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 3;
  const files = args;
  if (files.length === 0 || !(runs > 0)) {
    throw new Error('Usage: benchmark-threads.mjs [--runs N] <file relative to tests/fixtures>...');
  }

  console.log(`S4 on ${cpus()[0]?.model.trim() ?? 'unknown CPU'}, ${availableParallelism()} logical cores, Node ${process.version}; median of ${runs} runs\n`);
  let mismatch = false;
  for (const file of files) {
    const results = Object.fromEntries(variants.map((variant) => [variant, []]));
    for (let run = 0; run < runs; run++) {
      // Alternate the variants so drift (thermals, background load) hits both alike.
      for (const variant of run % 2 === 0 ? variants : [...variants].reverse()) {
        const output = execFileSync(
          process.execPath,
          ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), '--child', variant, file],
          { encoding: 'utf8', maxBuffer: 1 << 20 },
        );
        results[variant].push(JSON.parse(output.trim().split('\n').at(-1)));
      }
    }

    const [single, multi] = variants.map((variant) => summarise(results[variant]));
    if (single.triangles !== multi.triangles) {
      mismatch = true;
    }
    console.log(`${file}: ${single.triangles} triangles (multi: ${multi.triangles}), heap ${mb(single.heap)} single / ${mb(multi.heap)} multi`);
    console.log('| Phase | single (s) | multi (s) | speed-up |');
    console.log('|---|---|---|---|');
    for (const phase of [...phases, 'Total']) {
      const [a, b] = [single.times[phase], multi.times[phase]];
      console.log(`| ${phase} | ${seconds(a)} | ${seconds(b)} | ${b > 0 ? `${(a / b).toFixed(2)}×` : '—'} |`);
    }
    console.log();
  }
  if (mismatch) {
    console.error('The builds produced different triangle counts.');
    process.exit(1);
  }
}

function summarise(results) {
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const times = Object.fromEntries(phases.map((phase) => [phase, median(results.map((result) => result.times[phase]))]));
  times.Total = median(results.map((result) => result.total));
  return { times, triangles: results[0].triangles, heap: Math.max(...results.map((result) => result.heap)) };
}

function seconds(ms) {
  return (ms / 1000).toFixed(2);
}

function mb(bytes) {
  return `${(bytes / 2 ** 20).toFixed(0)} MB`;
}
