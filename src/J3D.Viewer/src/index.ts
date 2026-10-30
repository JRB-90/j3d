// @j3d/viewer: the three.js view of CAD and mesh models, with their import pipeline (D214, D250).

export {
  createViewer,
  detectCapabilities,
  type CreateViewerOptions,
  type ExpandOutcome,
  type ExportOutcome,
  type TransferOutcome,
  type ViewerCapabilities,
  type ViewerHandle,
} from './create-viewer.js';
export { detectFormat, fileInputAccept, kindOf, supportedExtensions } from './formats.js';
export type { ModelFormat, ModelKind } from './formats.js';
export type { ArrivedNode, ExpandedNode, KeptArrival, ModelEdits } from './edit/structure.js';
export type { ModelEntry, ModelManagerListener } from './import/model-manager.js';
export type {
  Bounds,
  BrepExportFormat,
  ImportError,
  ImportErrorCode,
  ImportPhase,
  LoadedModel,
  ModelId,
  ModelStats,
  ModelStatus,
  ModelSummary,
  TreeNode,
} from './import/types.js';
export type { StoredModel, StoredScene } from './store/types.js';
export type { Projection } from './view/camera-math.js';
export type { FeatureSelectionInfo } from './view/features.js';
export type { MeasureInfo, MeasureRow } from './view/measure-format.js';
export type { MeshExportFormat } from './view/mesh-export.js';
export type { MoveFrame, MoveMode, MoveTarget } from './view/move.js';
export type { ContextTarget, MoveTargetInfo, PartRef, SelectionMode, ViewerCommand, ViewerOptions } from './view/viewer.js';
