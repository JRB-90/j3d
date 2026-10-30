// Store worker: the only code that writes the origin private file system (D112). It streams each
// file into a synchronous access handle a chunk at a time, which every engine supports in a
// worker, and answers requests one at a time so a delete never overtakes the copy before it.

import type { WorkerScope } from '../../import/protocol.js';
import type { StoreRequestMessage, StoreResponse } from '../protocol.js';
import { respond, StoreOps, type DirectoryHandle } from '../store-ops.js';

const scope = globalThis as unknown as WorkerScope<StoreRequestMessage, StoreResponse>;

// The estimate tells a full store from a write that only came up short (D200).
const ops = navigator.storage.getDirectory().then((root) => new StoreOps(root as unknown as DirectoryHandle, () => navigator.storage.estimate()));
ops.catch(() => {}); // a page without a private file system: each request reports it instead
let queue: Promise<void> = Promise.resolve();

scope.onmessage = ({ data }) => {
  queue = queue.then(async () => scope.postMessage(await respond(ops, data)));
};
