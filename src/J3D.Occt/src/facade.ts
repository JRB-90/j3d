/**
 * TypeScript side of the J3D OCCT facade (wrappers/j3d_facade.cpp).
 *
 * Streams a file into WASM memory, imports it, meshes it and copies the results out of WASM memory
 * into plain typed arrays that can be transferred between threads. The C++ model stays alive (and
 * keeps its BREP) until {@link OcctModel.dispose} is called.
 */

/** Must match the constants in wrappers/j3d_facade.cpp. */
export const ImportFormat = { Step: 0, Iges: 1, Brep: 2 } as const;
export type ImportFormat = (typeof ImportFormat)[keyof typeof ImportFormat];

export const ImportStatus = { Ok: 0, ParseFailed: 1, Empty: 2, OutOfMemory: 3, Internal: 4 } as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

/** Reading is reported from TypeScript; the rest come from C++ via `Module.j3dProgress`. */
export const ImportPhase = { Reading: 0, Parsing: 1, Transferring: 2, Meshing: 3, Extracting: 4 } as const;
export type ImportPhase = (typeof ImportPhase)[keyof typeof ImportPhase];

/** Fraction in [0, 1], or a negative number while the phase has no measurable progress. */
export type ProgressCallback = (phase: ImportPhase, fraction: number) => void;

// Structural view of the embind classes, so this module does not depend on generated type names.
export interface J3DMeshDataHandle {
  getPositionsPtr(): number;
  getPositionsLength(): number;
  getNormalsPtr(): number;
  getIndicesPtr(): number;
  getIndicesLength(): number;
  getOpaqueIndexCount(): number;
  getColorsPtr(): number;
  getColorsLength(): number;
  getUniformColor(channel: number): number;
  getEdgesPtr(): number;
  getEdgesLength(): number;
  delete(): void;
}

export interface J3DModelHandle {
  allocateInput(byteLength: number): number;
  releaseInput(): void;
  importFile(format: number, fileName: string): number;
  mesh(linearDeflectionRatio: number, angularDeflection: number): number;
  getPrototypeCount(): number;
  extractPrototype(index: number): J3DMeshDataHandle;
  getSceneJson(): string;
  getLastError(): string;
  delete(): void;
}

export interface OcctModule {
  J3DModel: new () => J3DModelHandle;
  wasmMemory: WebAssembly.Memory;
  j3dProgress?: ((phase: number, fraction: number) => void) | undefined;
}

/** Geometry of one prototype (a unique part + style) in the part's own coordinates. */
export interface PrototypeMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Opaque triangles first, then translucent ones. */
  indices: Uint32Array;
  opaqueIndexCount: number;
  /** Linear RGBA per vertex; absent when the prototype has a single colour. */
  colors?: Float32Array;
  /** Linear RGBA of a single-colour prototype (also set for multi-colour ones: the first face). */
  uniformColor: [number, number, number, number];
  /** Line segments, two xyz points each. */
  edges: Float32Array;
}

export interface SceneNode {
  name: string;
  /** Index into nodes, or -1 for a root. */
  parent: number;
  /** Index into prototypes for a part, or -1 for an assembly. */
  prototype: number;
}

export interface SceneInstance {
  node: number;
  prototype: number;
  /** World transform, column-major 4x4 (Three.js Matrix4.fromArray order). */
  matrix: number[];
}

export interface ImportedScene {
  nodes: SceneNode[];
  instances: SceneInstance[];
  prototypes: PrototypeMesh[];
}

export interface ImportOptions {
  /** Linear deflection relative to the model's bounding-box diagonal. */
  linearDeflectionRatio?: number;
  /** Angular deflection in radians. */
  angularDeflection?: number;
  onProgress?: ProgressCallback;
}

export const DefaultLinearDeflectionRatio = 0.001;
export const DefaultAngularDeflection = 0.35;

export class OcctImportError extends Error {
  constructor(
    readonly status: ImportStatus,
    message: string,
  ) {
    super(message);
    this.name = 'OcctImportError';
  }
}

/** One imported model. Owns its C++ J3DModel (and therefore its BREP) until disposed. */
export class OcctModel implements Disposable {
  private constructor(
    private readonly module: OcctModule,
    private handle: J3DModelHandle | undefined,
    readonly scene: ImportedScene,
  ) {}

  /** Imports, meshes and extracts `source`. Throws {@link OcctImportError} on failure. */
  static async load(
    module: OcctModule,
    source: Blob | Uint8Array,
    format: ImportFormat,
    fileName: string,
    options: ImportOptions = {},
  ): Promise<OcctModel> {
    const { onProgress } = options;
    const handle = new module.J3DModel();
    module.j3dProgress = onProgress ? (phase, fraction) => onProgress(phase as ImportPhase, fraction) : undefined;
    try {
      await writeInput(module, handle, source, onProgress);
      check(handle, handle.importFile(format, fileName));
      check(
        handle,
        handle.mesh(options.linearDeflectionRatio ?? DefaultLinearDeflectionRatio, options.angularDeflection ?? DefaultAngularDeflection),
      );

      const { nodes, instances } = JSON.parse(handle.getSceneJson()) as Pick<ImportedScene, 'nodes' | 'instances'>;
      const prototypes = Array.from({ length: handle.getPrototypeCount() }, (_, index) =>
        extractPrototype(module, handle, index),
      );
      onProgress?.(ImportPhase.Extracting, 1);
      return new OcctModel(module, handle, { nodes, instances, prototypes });
    } catch (error) {
      handle.delete();
      throw error;
    } finally {
      module.j3dProgress = undefined;
    }
  }

  /** WASM heap size of the module this model lives in (one module per worker). */
  get memoryBytes(): number {
    return this.module.wasmMemory.buffer.byteLength;
  }

  dispose(): void {
    this.handle?.delete();
    this.handle = undefined;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

async function writeInput(
  module: OcctModule,
  handle: J3DModelHandle,
  source: Blob | Uint8Array,
  onProgress: ProgressCallback | undefined,
): Promise<void> {
  const size = source instanceof Uint8Array ? source.byteLength : source.size;
  const address = handle.allocateInput(size) >>> 0;
  if (address === 0) {
    throw new OcctImportError(ImportStatus.OutOfMemory, 'Out of memory while reading the file.');
  }

  onProgress?.(ImportPhase.Reading, 0);
  if (source instanceof Uint8Array) {
    new Uint8Array(module.wasmMemory.buffer, address, size).set(source);
  } else {
    // Stream in chunks so the whole file never sits in the JS heap as well as WASM memory.
    let offset = 0;
    const reader = source.stream().getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      // Re-read the buffer each time: nothing grows memory here, but it costs nothing to be safe.
      new Uint8Array(module.wasmMemory.buffer, address + offset, chunk.value.byteLength).set(chunk.value);
      offset += chunk.value.byteLength;
      onProgress?.(ImportPhase.Reading, size === 0 ? 1 : offset / size);
    }
  }
  onProgress?.(ImportPhase.Reading, 1);
}

function check(handle: J3DModelHandle, status: number): void {
  if (status !== ImportStatus.Ok) {
    throw new OcctImportError(status as ImportStatus, handle.getLastError() || 'Import failed.');
  }
}

function extractPrototype(module: OcctModule, handle: J3DModelHandle, index: number): PrototypeMesh {
  const data = handle.extractPrototype(index);
  try {
    // Views into WASM memory are invalidated by memory growth, so copy each one immediately.
    const positions = copyFloat32(module, data.getPositionsPtr(), data.getPositionsLength());
    const normals = copyFloat32(module, data.getNormalsPtr(), data.getPositionsLength());
    const indices = copyUint32(module, data.getIndicesPtr(), data.getIndicesLength());
    const colorsLength = data.getColorsLength();
    const mesh: PrototypeMesh = {
      positions,
      normals,
      indices,
      opaqueIndexCount: data.getOpaqueIndexCount(),
      uniformColor: [0, 1, 2, 3].map((channel) => data.getUniformColor(channel)) as PrototypeMesh['uniformColor'],
      edges: copyFloat32(module, data.getEdgesPtr(), data.getEdgesLength()),
    };
    if (colorsLength > 0) {
      mesh.colors = copyFloat32(module, data.getColorsPtr(), colorsLength);
    }
    return mesh;
  } finally {
    data.delete();
  }
}

function copyFloat32(module: OcctModule, address: number, length: number): Float32Array {
  return length === 0 ? new Float32Array(0) : new Float32Array(module.wasmMemory.buffer, address >>> 0, length).slice();
}

function copyUint32(module: OcctModule, address: number, length: number): Uint32Array {
  return length === 0 ? new Uint32Array(0) : new Uint32Array(module.wasmMemory.buffer, address >>> 0, length).slice();
}
