// Spike S2 (memory ceiling), Node baseline. Opt-in, since the files are generated and large:
//
//   npm run fixtures:large -- 25 50 100 200
//   J3D_LARGE_FIXTURES=25,50,100,200 npm test --workspace @j3d/occt -- large
//
// Each size gets a fresh OCCT instance, as each model gets its own worker in the browser. A model must
// either load or fail cleanly with OutOfMemory (the M2 exit criterion); the wasm32 heap tops out at 4 GB.

import { existsSync, openAsBlob } from 'node:fs';
import { describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import { ImportFormat, ImportPhase, ImportStatus, OcctImportError, OcctModel, type OcctModule } from './facade';

const sizes = (process.env['J3D_LARGE_FIXTURES'] ?? '').split(',').filter(Boolean);
const pathOf = (size: string) => new URL(`../../../tests/fixtures/large/large-${size}mb.step`, import.meta.url);

describe.runIf(sizes.length > 0)('large STEP (spike S2)', () => {
  it.each(sizes)('large-%smb.step loads or fails with OutOfMemory', async (size) => {
    const path = pathOf(size);
    expect(existsSync(path), `run "npm run fixtures:large -- ${size}" first`).toBe(true);

    const oc = (await init()) as unknown as OcctModule;
    const phaseTimes: string[] = [];
    let phaseStart = performance.now();
    let lastPhase = -1;
    const start = performance.now();
    try {
      using model = await OcctModel.load(oc, await openAsBlob(path), ImportFormat.Step, `large-${size}mb.step`, {
        onProgress: (phase) => {
          if (phase !== lastPhase) {
            const now = performance.now();
            if (lastPhase >= 0) phaseTimes.push(`${phaseName(lastPhase)} ${((now - phaseStart) / 1000).toFixed(1)} s`);
            [lastPhase, phaseStart] = [phase, now];
          }
        },
      });
      phaseTimes.push(`${phaseName(lastPhase)} ${((performance.now() - phaseStart) / 1000).toFixed(1)} s`);
      const triangles = model.scene.prototypes.reduce((sum, p) => sum + p.indices.length / 3, 0);
      console.log(
        `large-${size}mb.step: loaded ${model.scene.prototypes.length} parts, ${triangles} triangles; ` +
          `peak WASM heap ${mb(model.memoryBytes)}; ${seconds(start)} (${phaseTimes.join(', ')})`,
      );
    } catch (error) {
      console.log(`large-${size}mb.step: failed after ${seconds(start)}, heap ${mb(oc.wasmMemory.buffer.byteLength)}: ${String(error)}`);
      expect(error).toBeInstanceOf(OcctImportError);
      expect((error as OcctImportError).status).toBe(ImportStatus.OutOfMemory);
    }
  }, 60 * 60_000);
});

const phaseName = (phase: number) => Object.entries(ImportPhase).find(([, value]) => value === phase)?.[0] ?? String(phase);
const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MB`;
const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;
