// Messages between the ModelStore on the main thread and the store worker (D112). Files travel as
// Blobs, which the browser passes by reference rather than copying.

import type { ModelId } from '../import/types';
import type { KeptEdits, Manifest, StoredMeta } from './types';

export type StoreRequest =
  | { type: 'open' }
  | { type: 'save'; id: ModelId; meta: StoredMeta; files: Blob[] }
  | { type: 'load'; id: ModelId }
  | { type: 'delete'; id: ModelId }
  | { type: 'clear' }
  | { type: 'manifest'; manifest: Omit<Manifest, 'seq'> }
  /** A model's moves and edits, or null when it has none (M16, D205). */
  | { type: 'edits'; id: ModelId; kept: KeptEdits | null }
  /** Objects that arrived from another model, as a file in this one's folder (M18, D225). */
  | { type: 'writeArrival'; id: ModelId; name: string; file: Blob }
  | { type: 'readArrival'; id: ModelId; name: string }
  | { type: 'pruneArrivals'; id: ModelId; keep: string[] };

/** A request with the id its answer echoes. The worker answers them one at a time, in order. */
export type StoreRequestMessage = StoreRequest & { requestId: number };

export type StoreResponse =
  | { requestId: number; ok: true; value?: unknown }
  | { requestId: number; ok: false; message: string; full: boolean };
