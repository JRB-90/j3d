import { kindOf, type ModelFormat } from '../formats';
import { ModelImportError, toImportError } from './errors';
import { throttleProgress, type ProgressListener } from './progress';
import type { ImportRunner, ImportTask } from './runner';
import { planBatch, SidecarSet, UnusedSidecarReason, type BatchFile } from './sidecars';
import { editedStats } from '../edit/stats';
import { expandFileParts, expansionsOf } from '../edit/expand';
import { EditsMismatchError, expandedFileNodes, hasEdits, ModelStructure, type ModelEdits } from '../edit/structure';
import type { ImportError, ImportPhase, ImportResult, KeptPlacement, KeptState, LoadedModel, ModelId, ModelStatus, ModelSummary } from './types';

/** Model lifecycle events. Progress is limited to 10 reports per second per model. */
export interface ModelManagerListener {
  queued?(summary: ModelSummary): void;
  progress?(id: ModelId, phase: ImportPhase, fraction: number | null): void;
  loaded?(model: LoadedModel): void;
  failed?(id: ModelId, error: ImportError): void;
  removed?(id: ModelId): void;
  /** A file that won't be imported: an unsupported type, or a sidecar no model in its batch used. */
  rejected?(fileName: string, reason: string): void;
}

/** A snapshot of one model's state. */
export interface ModelEntry {
  summary: ModelSummary;
  status: ModelStatus;
  phase?: ImportPhase;
  fraction?: number | null;
  model?: LoadedModel;
  error?: ImportError;
}

export const DefaultConcurrency = 2;

interface Batch {
  sidecars: SidecarSet;
  /** Models of the batch that haven't finished (loaded, failed or removed) yet. */
  pending: number;
}

interface Entry extends ModelEntry {
  /** The model's file; a kept model has none until its files are read from the store. */
  file?: BatchFile;
  batch: Batch;
  /** The sidecars its import found, which are kept with it (D113). */
  used: Set<BatchFile>;
  restored?: KeptState;
  task?: ImportTask;
  finished: boolean;
  report: ProgressListener;
}

/**
 * Owns every model from the moment its file is picked or dropped until it is removed: queues
 * imports, runs at most `concurrency` at a time, and cancels or frees them on removal
 * (docs/plan.md §6.2).
 */
export class ModelManager {
  private readonly entries = new Map<ModelId, Entry>();
  private readonly queue: Entry[] = [];
  private readonly listeners = new Set<ModelManagerListener>();
  private running = 0;

  constructor(
    private readonly runnerFor: (format: ModelFormat) => ImportRunner,
    private readonly concurrency = DefaultConcurrency,
    private readonly newId: () => ModelId = () => crypto.randomUUID(),
  ) {}

  subscribe(listener: ModelManagerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get models(): ModelEntry[] {
    return [...this.entries.values()].map(({ summary, status, phase, fraction, model, error }) => ({
      summary,
      status,
      ...(phase === undefined ? {} : { phase, fraction }),
      ...(model ? { model } : {}),
      ...(error ? { error } : {}),
    }));
  }

  /** Queues every model in one picker selection or drop; sidecars are matched within the batch. */
  importFiles(files: readonly BatchFile[]): ModelSummary[] {
    const plan = planBatch(files);
    const batch: Batch = { sidecars: plan.sidecars, pending: plan.models.length };

    for (const { fileName, reason } of plan.rejected) {
      this.emit((l) => l.rejected?.(fileName, reason));
    }

    const summaries = plan.models.map(({ file, format }) => {
      const summary: ModelSummary = {
        id: this.newId(),
        fileName: file.file.name,
        format,
        kind: kindOf(format),
        sizeBytes: file.file.size,
      };
      const entry: Entry = { summary, status: 'queued', file, batch, used: new Set(), finished: false, report: this.reporter(summary.id) };
      this.entries.set(summary.id, entry);
      this.queue.push(entry);
      this.emit((l) => l.queued?.(summary));
      return summary;
    });

    if (plan.models.length === 0) {
      this.reportUnusedSidecars(batch);
    }
    this.pump();
    return summaries;
  }

  /**
   * Queues a model again from its kept files, under its old id (M8, D117): after a reload or an
   * undone delete. It's listed at once and imports once the files are read, its own file first;
   * when they can't be read, it fails with `MissingFile`. Its hidden parts go with the loaded model.
   */
  importStored(
    summary: ModelSummary,
    files: Promise<readonly BatchFile[]>,
    hidden: readonly number[],
    placements: readonly KeptPlacement[] = [],
    edits?: ModelEdits,
  ): void {
    if (this.entries.has(summary.id)) {
      return;
    }
    const entry: Entry = {
      summary,
      status: 'queued',
      batch: { sidecars: new SidecarSet([]), pending: 1 },
      used: new Set(),
      restored: {
        hidden: [...hidden],
        ...(placements.length > 0 ? { placements: placements.map((kept) => ({ ...kept })) } : {}),
        ...(hasEdits(edits) ? { edits } : {}),
      },
      finished: false,
      report: this.reporter(summary.id),
    };
    this.entries.set(summary.id, entry);
    this.emit((l) => l.queued?.(summary));

    const waiting = () => this.entries.get(summary.id) === entry && entry.status === 'queued' && !entry.file;
    files.then(
      ([file, ...sidecars]) => {
        if (waiting()) {
          if (file) {
            entry.file = file;
            entry.batch.sidecars = new SidecarSet(sidecars);
            this.queue.push(entry);
            this.pump();
          } else {
            this.fail(entry, { code: 'MissingFile', message: "Its kept copy couldn't be read." });
          }
        }
      },
      (error: unknown) => {
        if (waiting()) {
          console.warn(`J3D: the kept copy of ${summary.fileName} couldn't be read.`, error);
          this.fail(entry, { code: 'MissingFile', message: "Its kept copy couldn't be read." });
        }
      },
    );
  }

  /** A model's file and the sidecars its import used, for keeping it (D113). */
  sourcesOf(id: ModelId): BatchFile[] | undefined {
    const entry = this.entries.get(id);
    return entry?.file ? [entry.file, ...entry.used] : undefined;
  }

  /**
   * Removes a model whatever its state: cancels a queued or running import, frees a loaded model
   * (terminating its worker), or dismisses a failed one. Returns false for an unknown id.
   */
  remove(id: ModelId): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    this.entries.delete(id);
    const queued = this.queue.indexOf(entry);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
    }
    if (entry.status === 'importing') {
      this.running--;
    }
    entry.task?.dispose();
    this.emit((l) => l.removed?.(id));
    this.finish(entry);
    this.pump();
    return true;
  }

  /** Cancels every import and frees every model, without events. */
  dispose(): void {
    this.queue.length = 0;
    for (const entry of this.entries.values()) {
      entry.task?.dispose();
    }
    this.entries.clear();
    this.listeners.clear();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      this.start(this.queue.shift()!);
    }
  }

  private start(entry: Entry): void {
    const { summary, file, batch } = entry;
    entry.status = 'importing';
    this.running++;

    try {
      entry.task = this.runnerFor(summary.format)({
        file: file!.file,
        fileName: summary.fileName,
        path: file!.path,
        format: summary.format,
        sidecars: batch.sidecars.forModel(entry.used),
        onProgress: (phase, fraction) => {
          if (this.entries.get(summary.id) === entry && entry.status === 'importing') {
            entry.phase = phase;
            entry.fraction = fraction;
            entry.report(phase, fraction);
          }
        },
      });
    } catch (error) {
      entry.task = { result: Promise.reject(error), dispose() {} };
    }

    entry.task.result
      .then(async (result) => {
        // A kept model's expanded parts (M15) are expanded again before its edits are checked (R25);
        // one that can't be leaves its edits not fitting.
        const expanded = expandedFileNodes(result.tree.length, entry.restored?.edits);
        if (expanded.length > 0) {
          await expandFileParts(result.content, expanded).catch(() => undefined);
        }
        return result;
      })
      .then(
        (result) => this.settle(entry, result),
        (error: unknown) => this.settle(entry, error instanceof ModelImportError ? error : toImportError(error)),
      );
  }

  private settle(entry: Entry, outcome: ImportResult | ModelImportError | ImportError): void {
    if (this.entries.get(entry.summary.id) !== entry || entry.status !== 'importing') {
      return; // removed while importing
    }

    this.running--;
    if ('content' in outcome) {
      const restored = entry.restored && keptStateFor(entry.summary, outcome, entry.restored);
      const model: LoadedModel = { summary: entry.summary, ...outcome, ...(restored ? { restored } : {}) };
      entry.status = 'loaded';
      entry.model = model;
      this.emit((l) => l.loaded?.(model));
      this.finish(entry);
    } else {
      this.fail(entry, { code: outcome.code, message: outcome.message });
    }
    this.pump();
  }

  private fail(entry: Entry, error: ImportError): void {
    entry.status = 'failed';
    entry.error = error;
    entry.task?.dispose(); // a failed import keeps nothing alive
    this.emit((l) => l.failed?.(entry.summary.id, error));
    this.finish(entry);
  }

  private reporter(id: ModelId): ProgressListener {
    return throttleProgress((phase, fraction) => this.emit((l) => l.progress?.(id, phase, fraction)));
  }

  /** Counts the model off its batch; the last one to finish reports the batch's unused sidecars. */
  private finish(entry: Entry): void {
    if (!entry.finished) {
      entry.finished = true;
      if (--entry.batch.pending === 0) {
        this.reportUnusedSidecars(entry.batch);
      }
    }
  }

  private reportUnusedSidecars(batch: Batch): void {
    for (const unused of batch.sidecars.unused()) {
      this.emit((l) => l.rejected?.(unused.file.name, UnusedSidecarReason));
    }
  }

  private emit(event: (listener: ModelManagerListener) => void): void {
    for (const listener of this.listeners) {
      try {
        event(listener);
      } catch (error) {
        console.error('J3D: a model event listener failed.', error);
      }
    }
  }
}

/** Shown in a model's item when its kept edits no longer fit it (R25). */
export const EditsDroppedWarning = "Its edits couldn't be applied again, so it's shown as imported.";

/**
 * A restored model's kept state, its edits checked against the tree the file gave this time (R25):
 * when they fit, its counts are the edited model's; when they don't, its edits and moves are dropped
 * (moves are kept in the edited tree's frames) and it loads as imported, with a warning.
 */
function keptStateFor(summary: ModelSummary, result: ImportResult, kept: KeptState): KeptState {
  if (!kept.edits) {
    return kept;
  }
  try {
    const structure = new ModelStructure(result.tree, kept.edits, expansionsOf(result.content));
    result.stats = editedStats(result.content, structure, result.stats);
    return kept;
  } catch (error) {
    if (!(error instanceof EditsMismatchError)) {
      throw error;
    }
    console.warn(`J3D: ${summary.fileName}'s kept edits don't fit it, so it's shown as imported.`, error);
    result.warnings = [...result.warnings, EditsDroppedWarning];
    return { hidden: kept.hidden.filter((node) => node < result.tree.length) };
  }
}
