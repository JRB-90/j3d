// Messages between the main thread and the mesh workers. Bulk data always travels in transferred
// ArrayBuffers; everything else is small. A model worker's are the kernel's (`@j3d/occt`).

import type { FailedMessage, ProgressMessage } from '@j3d/occt/core';
import type { SerializedMeshScene } from './mesh/serialize.js';

export type WorkerMeshFormat = 'stl' | 'obj';

/** Main thread → mesh worker (one per STL/OBJ import, terminated once it answers). */
export interface MeshWorkerRequest {
  type: 'parse';
  file: Blob;
  fileName: string;
  format: WorkerMeshFormat;
}

/** Mesh worker → main thread. */
export type MeshWorkerResponse = ProgressMessage | FailedMessage | { type: 'parsed'; scene: SerializedMeshScene };
