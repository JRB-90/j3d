import type { ModelManager } from './import/model-manager';
import type { Bounds, ModelStats, TreeNode } from './import/types';
import type { DotNetObjectReference } from './interop';

/** What .NET is told about a loaded model (mirrors J3D.Web.Client/Interop/ModelLoadedInfo.cs). */
export interface ModelLoadedInfo {
  tree: TreeNode[];
  stats: ModelStats;
  bounds: Bounds;
  memoryBytes: number;
  warnings: string[];
}

/**
 * Relays the model manager's events to the Blazor `Viewport` (docs/plan.md §6.4). Only small DTOs
 * cross into .NET: summaries, progress, a loaded model's tree and stats, errors and rejections.
 * Returns the unsubscribe function.
 */
export function forwardModelEvents(models: Pick<ModelManager, 'subscribe'>, dotnet: DotNetObjectReference): () => void {
  const send = (method: string, ...args: unknown[]) => {
    dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
  };
  return models.subscribe({
    queued: (summary) => send('OnModelQueued', summary),
    progress: (id, phase, fraction) => send('OnModelProgress', id, phase, fraction),
    loaded: ({ summary, tree, stats, bounds, memoryBytes, warnings }) => {
      const info: ModelLoadedInfo = { tree, stats, bounds, memoryBytes, warnings };
      send('OnModelLoaded', summary.id, info);
    },
    failed: (id, error) => send('OnModelFailed', id, error),
    removed: (id) => send('OnModelRemoved', id),
    rejected: (fileName, reason) => send('OnImportRejected', fileName, reason),
  });
}
