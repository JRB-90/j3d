// Mesh worker: parses one STL or OBJ file off the main thread, posts the buffers back (transferred)
// and is then terminated (docs/plan.md §6.2).

import { toImportError } from '../errors.js';
import { parseObj, parseStl } from '../mesh/parse.js';
import { meshTransferables } from '../mesh/serialize.js';
import { throttleProgress } from '../progress.js';
import type { MeshWorkerRequest, MeshWorkerResponse, WorkerScope } from '../protocol.js';
import { readBlob } from '../read-blob.js';

const scope = globalThis as unknown as WorkerScope<MeshWorkerRequest, MeshWorkerResponse>;

scope.onmessage = async ({ data }) => {
  const report = throttleProgress((phase, fraction) => scope.postMessage({ type: 'progress', phase, fraction }));
  try {
    const bytes = await readBlob(data.file, (fraction) => report('reading', fraction));
    report('parsing', null);
    const scene = data.format === 'stl' ? parseStl(bytes, data.fileName) : parseObj(bytes);
    scope.postMessage({ type: 'parsed', scene }, meshTransferables(scene));
  } catch (error) {
    scope.postMessage({ type: 'failed', error: toImportError(error) });
  }
};
