// Model worker: one per BREP model. Instantiates the shared OCCT module, imports the file, posts the
// meshes back (transferred, not copied) and then keeps the C++ model, and with it the BREP, alive
// until the main thread terminates the worker (docs/plan.md §6.2).

import { ExportFormat, ExportStatus, ImportFormat, OcctExportError, OcctModel, type OcctModule } from '@j3d/occt/facade';
import createOcct, { type InitOpenCascadeOptions } from '@j3d/occt/single';
import { sceneTransferables, summariseBrepScene } from '../brep-summary';
import { toImportError } from '../errors';
import { throttleProgress } from '../progress';
import type {
  BrepExportFormat,
  ExportRequest,
  ImportRequestMessage,
  MeasureRequest,
  ModelWorkerRequest,
  ModelWorkerResponse,
  OcctFormat,
  WorkerScope,
} from '../protocol';
import type { ImportPhase } from '../types';

const scope = globalThis as unknown as WorkerScope<ModelWorkerRequest, ModelWorkerResponse>;

const occtFormats: Readonly<Record<OcctFormat, ImportFormat>> = {
  step: ImportFormat.Step,
  iges: ImportFormat.Iges,
  brep: ImportFormat.Brep,
};

// Indexed by the facade's numeric ImportPhase.
const phases: readonly ImportPhase[] = ['reading', 'parsing', 'transferring', 'meshing', 'extracting'];

const exportFormats: Readonly<Record<BrepExportFormat, ExportFormat>> = {
  step: ExportFormat.Step,
  brep: ExportFormat.Brep,
};

// Kept alive, with its BREP, for measuring (M7) and saving (M9).
let model: OcctModel | undefined;

scope.onmessage = ({ data }) => {
  if (data.type === 'import') {
    void runImport(data);
  } else if (data.type === 'export') {
    exportModel(data);
  } else {
    measure(data);
  }
};

/**
 * Writes the whole model as STEP or BREP (M9, D83) and transfers the bytes. OCCT reports progress
 * about ten times a second, and polls the shared flag the page sets to cancel (D125).
 */
function exportModel(request: ExportRequest): void {
  const flag = request.cancel ? new Int32Array(request.cancel) : undefined;
  const isCancelled = () => flag !== undefined && Atomics.load(flag, 0) !== 0;
  try {
    if (!model) {
      throw new Error('The model is not loaded.');
    }
    if (isCancelled()) {
      throw new OcctExportError(ExportStatus.Cancelled, 'Export cancelled.');
    }
    const bytes = model.exportFile(exportFormats[request.format], {
      onProgress: (_, fraction) => scope.postMessage({ type: 'exportProgress', id: request.id, fraction: fraction < 0 ? null : fraction }),
      isCancelled,
    });
    scope.postMessage({ type: 'exported', id: request.id, bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({
      type: 'exportFailed',
      id: request.id,
      cancelled: error instanceof OcctExportError && error.status === ExportStatus.Cancelled,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Answers a measurement query on the loaded model (M7). Queries run one at a time, in order. */
function measure(request: MeasureRequest): void {
  try {
    if (!model) {
      throw new Error('The model is not loaded.');
    }
    const result =
      request.type === 'measureEntity'
        ? model.measureEntity(request.entity)
        : request.type === 'measurePair'
          ? model.measurePair(request.a, request.b, request.shapeB)
          : model.exportEntity(request.entity);
    scope.postMessage({ type: 'measured', id: request.id, result });
  } catch (error) {
    scope.postMessage({ type: 'measureFailed', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

async function runImport(request: ImportRequestMessage): Promise<void> {
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
