// Spike S2 (memory ceiling), Node baseline. Opt-in, since the files are generated and large:
//
//   npm run fixtures:large -- 25 50 100 200
//   J3D_LARGE_FIXTURES=25,50,100,200 npm test --workspace @j3d/occt -- large
//
// Each size gets a fresh OCCT instance, as each model gets its own worker in the browser. A model must
// either load or fail cleanly with OutOfMemory (the M2 exit criterion); the wasm32 heap tops out at 4 GB.
// Since M11 (D141) each loaded file is also exported as STEP and BREP, which must either work or fail
// cleanly with OutOfMemory, after a STEP export cancelled part-way, which must leave the model usable.

import { existsSync, openAsBlob } from 'node:fs';
import { describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import {
  EntityKind,
  ExportFormat,
  ExportStatus,
  ImportFormat,
  ImportPhase,
  ImportStatus,
  OcctExportError,
  OcctImportError,
  OcctModel,
  type OcctModule,
} from './facade.js';

const sizes = (process.env['J3D_LARGE_FIXTURES'] ?? '').split(',').filter(Boolean);
/**
 * `200` is large-200mb.step (block copies), `curved-100` is curved-100mb.step, `plant-10000` is
 * plant-10000.step and `so101` is so101.step (see scripts/generate-large-step.mjs).
 */
const fileOf = (name: string) =>
  name.startsWith('curved-') ? `${name}mb.step` : /^(plant-\d+|so101)$/.test(name) ? `${name}.step` : `large-${name}mb.step`;
const pathOf = (name: string) => new URL(`../../../tests/fixtures/large/${fileOf(name)}`, import.meta.url);

describe.runIf(sizes.length > 0)('large STEP (spike S2)', () => {
  it.each(sizes)('%s loads or fails with OutOfMemory', async (size) => {
    const path = pathOf(size);
    expect(existsSync(path), `run "npm run fixtures:large -- ${size}" first`).toBe(true);

    const oc = (await init()) as unknown as OcctModule;
    const phaseTimes: string[] = [];
    let phaseStart = performance.now();
    let lastPhase = -1;
    const start = performance.now();
    try {
      using model = await OcctModel.load(oc, await openAsBlob(path), ImportFormat.Step, fileOf(size), {
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
        `${fileOf(size)}: loaded ${model.scene.prototypes.length} unique parts placed ${model.scene.instances.length} times, ${triangles} triangles; ` +
          `peak WASM heap ${mb(model.memoryBytes)}; ${seconds(start)} (${phaseTimes.join(', ')})`,
      );
    } catch (error) {
      console.log(`${fileOf(size)}: failed after ${seconds(start)}, heap ${mb(oc.wasmMemory.buffer.byteLength)}: ${String(error)}`);
      expect(error).toBeInstanceOf(OcctImportError);
      expect((error as OcctImportError).status).toBe(ImportStatus.OutOfMemory);
    }
  }, 60 * 60_000);

  it.each(sizes)('%s exports as STEP and BREP, or fails with OutOfMemory', async (size) => {
    const path = pathOf(size);
    expect(existsSync(path), `run "npm run fixtures:large -- ${size}" first`).toBe(true);

    const oc = (await init()) as unknown as OcctModule;
    let model: OcctModel;
    try {
      model = await OcctModel.load(oc, await openAsBlob(path), ImportFormat.Step, fileOf(size));
    } catch (error) {
      expect((error as OcctImportError).status).toBe(ImportStatus.OutOfMemory);
      console.log(`${fileOf(size)}: too large to load, so not exported`);
      return;
    }

    try {
      const results = [`loaded with a ${mb(model.memoryBytes)} heap`];

      // Cancelled two seconds in: OCCT's progress indicator breaks the transfer at its next poll.
      const start = performance.now();
      let asked = 0;
      const isCancelled = () => {
        if (asked === 0 && performance.now() - start > 2000) asked = performance.now();
        return asked > 0;
      };
      const cancelled = attempt(() => model.exportFile(ExportFormat.Step, { isCancelled }));
      if (cancelled instanceof Uint8Array) {
        // Small files finish, or reach the writer's last phase (which doesn't poll), within two seconds.
        results.push(`STEP finished in ${seconds(start)}, before the cancel landed`);
      } else {
        expect(cancelled).toBeInstanceOf(OcctExportError);
        expect(cancelled).toMatchObject({ status: ExportStatus.Cancelled });
        results.push(`STEP cancelled ${((performance.now() - asked) / 1000).toFixed(1)} s after asking`);
      }

      for (const [format, name, header] of [
        [ExportFormat.Step, 'STEP', 'ISO-10303-21;'],
        [ExportFormat.Brep, 'BREP', 'CASCADE Topology'],
      ] as const) {
        const begun = performance.now();
        const bytes = attempt(() => model.exportFile(format));
        if (bytes instanceof Uint8Array) {
          expect(new TextDecoder().decode(bytes.subarray(0, 64))).toContain(header);
          results.push(`${name} of ${mb(bytes.byteLength)} in ${seconds(begun)}, heap ${mb(model.memoryBytes)}`);
        } else {
          results.push(`${name} failed after ${seconds(begun)}, heap ${mb(model.memoryBytes)}: ${String(bytes)}`);
          expect(bytes).toBeInstanceOf(OcctExportError);
          expect(bytes).toMatchObject({ status: ExportStatus.OutOfMemory });
        }
      }

      // Whatever happened, the model still answers.
      const face = model.measureEntity({ kind: EntityKind.Face, prototype: 0, index: 0, matrix: model.scene.instances[0]!.matrix });
      expect(face.kind).toBe('face');
      console.log(`${fileOf(size)}: ${results.join('; ')}`);
    } finally {
      model.dispose();
    }
  }, 60 * 60_000);
});

/** The function's result, or what it threw. */
function attempt(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return error;
  }
}

const phaseName = (phase: number) => Object.entries(ImportPhase).find(([, value]) => value === phase)?.[0] ?? String(phase);
const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MB`;
const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;
