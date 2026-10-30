// What the kernel shares with other code, with no worker in it, so a worker of another package can
// use it without a bundler following `openModel` into the model worker.

export { ModelImportError, OutOfMemoryMessage, OutOfWasmMemoryMessage, errorMessage, toImportError } from './errors.js';
export { ProgressIntervalMs, throttleProgress, type ProgressListener } from './progress.js';
export type { FailedMessage, ProgressMessage, WorkerScope } from './protocol.js';
export {
  ExportCancelledError,
  type Bounds,
  type BrepArriver,
  type BrepExpander,
  type BrepExporter,
  type BrepExportFormat,
  type BrepMeasurer,
  type ImportError,
  type ImportErrorCode,
  type ImportPhase,
  type ModelStats,
  type OcctFormat,
  type Vector3Tuple,
} from './types.js';
