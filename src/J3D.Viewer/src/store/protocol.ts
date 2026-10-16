// Messages between the ModelStore on the main thread and the store worker (D112). Files travel as
// Blobs, which the browser passes by reference rather than copying.

import type { ModelId } from '../import/types';
import type { Manifest, StoredMeta } from './types';

export type StoreRequest =
  | { type: 'open' }
  | { type: 'save'; id: ModelId; meta: StoredMeta; files: Blob[] }
  | { type: 'load'; id: ModelId }
  | { type: 'delete'; id: ModelId }
  | { type: 'clear' }
  | { type: 'manifest'; manifest: Omit<Manifest, 'seq'> };

/** A request with the id its answer echoes. The worker answers them one at a time, in order. */
export type StoreRequestMessage = StoreRequest & { requestId: number };

export type StoreResponse =
  | { requestId: number; ok: true; value?: unknown }
  | { requestId: number; ok: false; message: string; full: boolean };
