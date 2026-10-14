// Model worker: one per BREP model. Instantiates the shared OCCT module, imports the file, posts the
// meshes back (transferred, not copied) and then keeps the C++ model, and with it the BREP, alive
// until the main thread terminates the worker (docs/plan.md §6.2).

import { ImportFormat, OcctModel, type OcctModule } from '@j3d/occt/facade';
import createOcct, { type InitOpenCascadeOptions } from '@j3d/occt/single';
import { sceneTransferables, summariseBrepScene } from '../brep-summary';
import { toImportError } from '../errors';
import { throttleProgress } from '../progress';
import type { ModelWorkerRequest, ModelWorkerResponse, OcctFormat, WorkerScope } from '../protocol';
import type { ImportPhase } from '../types';

const scope = globalThis as unknown as WorkerScope<ModelWorkerRequest, ModelWorkerResponse>;

const occtFormats: Readonly<Record<OcctFormat, ImportFormat>> = {
  step: ImportFormat.Step,
  iges: ImportFormat.Iges,
  brep: ImportFormat.Brep,
};

// Indexed by the facade's numeric ImportPhase.
const phases: readonly ImportPhase[] = ['reading', 'parsing', 'transferring', 'meshing', 'extracting'];

// Held only to keep the C++ model (and its BREP) alive for later features such as picking.
let model: OcctModel | undefined;

scope.onmessage = ({ data }) => void runImport(data);

async function runImport(request: ModelWorkerRequest): Promise<void> {
  const report = throttleProgress((phase, fraction) => scope.postMessage({ type: 'progress', phase, fraction }));
  try {
    report('reading', 0);
    const module = await instantiate(request.module);
    if (request.holdBeforeImport) {
      scope.postMessage({ type: 'held' });
      return; // a held import waits, with its WASM heap allocated, until it is cancelled
    }

    model = await OcctModel.load(module, request.file, occtFormats[request.format], request.fileName, {
      onProgress: (phase, fraction) => report(phases[phase] ?? 'parsing', fraction < 0 ? null : fraction),
    });

    const { scene } = model;
    const { bounds, stats } = summariseBrepScene(scene);
    scope.postMessage(
      { type: 'loaded', scene, bounds, stats, memoryBytes: model.memoryBytes },
      sceneTransferables(scene),
    );
  } catch (error) {
    scope.postMessage({ type: 'failed', error: toImportError(error, true) });
  }
}

/** Instantiates the precompiled module, so no worker fetches or compiles the 15 MB WASM itself. */
function instantiate(compiled: WebAssembly.Module): Promise<OcctModule> {
  return new Promise<OcctModule>((resolve, reject) => {
    // Emscripten's hook; the generated options type doesn't declare it.
    const options: InitOpenCascadeOptions & { instantiateWasm: unknown } = {
      instantiateWasm(
        imports: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) {
        WebAssembly.instantiate(compiled, imports).then((instance) => receiveInstance(instance, compiled), reject);
        return {};
      },
      // OCCT's own messages (e.g. STEP syntax errors) help diagnose failures but aren't app errors.
      print: (text) => console.debug('[OCCT]', text),
      printErr: (text) => console.warn('[OCCT]', text),
    };
    createOcct(options).then((instance) => resolve(instance as unknown as OcctModule), reject);
  });
}
