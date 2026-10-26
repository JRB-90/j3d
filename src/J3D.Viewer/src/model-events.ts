import { encodeEdits } from './edit/edits-codec';
import type { ModelManager } from './import/model-manager';
import type { Bounds, ModelStats, TreeNode } from './import/types';
import type { DotNetObjectReference } from './interop';

/**
 * A model's tree as one array per field, parents before children (mirrors TreeColumns in
 * J3D.Web.Client/Interop/ModelLoadedInfo.cs). .NET reads three arrays far faster than an object per
 * node: a 10,437-node tree took 850 ms as objects (decision D63).
 */
export interface TreeColumns {
  names: string[];
  parents: number[];
  prototypes: number[];
  /** The compound parts Expand can split (M15, D190), when there are any. */
  expandable?: number[];
}

/**
 * What .NET is told about a loaded model (mirrors J3D.Web.Client/Interop/ModelLoadedInfo.cs). Since M16
 * the tree and a restored model's kept edits cross packed beside it (D204): as JSON, .NET took 450 ms to
 * read the large plant's after Expand all.
 */
export interface ModelLoadedInfo {
  stats: ModelStats;
  bounds: Bounds;
  memoryBytes: number;
  warnings: string[];
}

/**
 * Relays the model manager's events to the Blazor `Viewport` (docs/plan.md §6.4). Only small DTOs
 * cross into .NET: summaries, progress, a loaded model's tree and stats, errors and rejections.
 * Reading a large tree takes .NET a while (about 140 ms for 10,000 nodes), so `OnModelLoaded` runs in
 * a task of its own, after the viewer has added the model, rather than lengthening that task (D63).
 * Calls made meanwhile wait behind it, so .NET still sees each model's events in order. Returns the
 * unsubscribe function, which also drops any calls still waiting.
 */
export function forwardModelEvents(models: Pick<ModelManager, 'subscribe'>, dotnet: DotNetObjectReference): () => void {
  let waiting: (() => void)[] | null = null;
  const call = (method: string, args: unknown[]) => () => {
    dotnet.invokeMethodAsync(method, ...args).catch((error: unknown) => console.error(`J3D: .NET's ${method} failed.`, error));
  };
  const send = (method: string, ...args: unknown[]) => {
    if (waiting) {
      waiting.push(call(method, args));
    } else {
      call(method, args)();
    }
  };
  const sendInOwnTask = (method: string, ...args: unknown[]) => {
    if (!waiting) {
      const calls: (() => void)[] = [];
      waiting = calls;
      setTimeout(() => {
        if (waiting === calls) {
          waiting = null;
          calls.forEach((run) => run());
        }
      }, 0);
    }
    waiting.push(call(method, args));
  };

  const unsubscribe = models.subscribe({
    queued: (summary) => send('OnModelQueued', summary),
    progress: (id, phase, fraction) => send('OnModelProgress', id, phase, fraction),
    loaded: ({ summary, tree, stats, bounds, memoryBytes, warnings, restored }) => {
      const info: ModelLoadedInfo = { stats, bounds, memoryBytes, warnings };
      const columns = packTree(toColumns(tree));
      const edits = restored?.edits ? encodeEdits(restored.edits) : null;
      sendInOwnTask('OnModelLoaded', summary.id, info, columns.numbers, columns.text, edits?.numbers ?? null, edits?.text ?? null);
    },
    failed: (id, error) => send('OnModelFailed', id, error),
    removed: (id) => send('OnModelRemoved', id),
    rejected: (fileName, reason) => send('OnImportRejected', fileName, reason),
  });
  return () => {
    unsubscribe();
    waiting = null;
  };
}

/** The tree as .NET receives it. */
export function toColumns(tree: readonly (TreeNode & { pieces?: number })[]): TreeColumns {
  const expandable = tree.flatMap((node, index) => ((node.pieces ?? 0) >= 2 ? [index] : []));
  return {
    names: tree.map((node) => node.name),
    parents: tree.map((node) => node.parent),
    prototypes: tree.map((node) => node.prototype),
    ...(expandable.length > 0 ? { expandable } : {}),
  };
}

/**
 * A tree's columns packed for .NET (M16, D204), as edits-codec.ts packs edits: `version, n,
 * parents (n), prototypes (n), name lengths (n), expandable.length, ...expandable` as 32-bit integers,
 * and the names one after another in `text`. J3D.Web.Client's TreeCodec reads it.
 */
export function packTree({ names, parents, prototypes, expandable = [] }: TreeColumns): { numbers: Uint8Array; text: string } {
  const values = Int32Array.from([1, names.length, ...parents, ...prototypes, ...names.map((name) => name.length), expandable.length, ...expandable]);
  return { numbers: new Uint8Array(values.buffer), text: names.join('') };
}
