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
  getFaceRangesPtr(): number;
  getFaceRangesLength(): number;
  getEdgeRangesPtr(): number;
  getEdgeRangesLength(): number;
  getVerticesPtr(): number;
  getVerticesLength(): number;
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
  measureEntity(kind: number, prototype: number, index: number, matrix: string): string;
  measurePair(
    kindA: number,
    prototypeA: number,
    indexA: number,
    matrixA: string,
    kindB: number,
    prototypeB: number,
    indexB: number,
    matrixB: string,
    shapeB: string,
  ): string;
  exportEntity(kind: number, prototype: number, index: number): string;
  exportFile(format: number): number;
  expandNode(node: number): string;
  arrive(base: number): string;
  exportTree(format: number, plan: string): number;
  getOutputLength(): number;
  getOutputChunkCount(): number;
  getOutputChunkPtr(index: number): number;
  getOutputChunkLength(index: number): number;
  releaseOutput(): void;
  delete(): void;
}

export interface OcctModule {
  J3DModel: new () => J3DModelHandle;
  wasmMemory: WebAssembly.Memory;
  j3dProgress?: ((phase: number, fraction: number) => void) | undefined;
  j3dCancelled?: (() => boolean) | undefined;
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
  /** (first index, index count) per BREP face, in face order: the face's triangles in `indices` (M7). */
  faceRanges: Uint32Array;
  /** (first point, point count) per BREP edge, in edge order: the edge's segments in `edges`. */
  edgeRanges: Uint32Array;
  /** xyz per BREP vertex, in vertex order. */
  vertices: Float32Array;
}

export interface SceneNode {
  name: string;
  /** Index into nodes, or -1 for a root. */
  parent: number;
  /** Index into prototypes for a part, or -1 for an assembly. */
  prototype: number;
  /**
   * The placement in the parent's frame (a root's is its world placement), column-major 4x4 (M13, D150).
   * Always there from the facade; scenes built by hand in tests may leave it out (identity).
   */
  matrix?: number[];
  /** For a compound part, the parts Expand would make of it (M15, D190); absent when fewer than two. */
  pieces?: number;
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

/** The WASM heap's ceiling: MAXIMUM_MEMORY in libcascade.config.ts. */
export const MaximumHeapBytes = 4 * 2 ** 30;

/**
 * OCCT's readers catch their own allocation failures and report an unreadable file instead. A
 * failure with the heap grown this close to its ceiling is reported as out of memory (spike S2: a
 * 700 MB STEP failed as "not readable" with the heap at 3.9 of 4 GB).
 */
export const OutOfMemoryHeapFraction = 0.9;

export class OcctImportError extends Error {
  constructor(
    readonly status: ImportStatus,
    message: string,
  ) {
    super(message);
    this.name = 'OcctImportError';
  }
}

/** Must match the entity kinds in wrappers/j3d_facade.cpp. */
export const EntityKind = { Face: 0, Edge: 1, Vertex: 2 } as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/** A face, edge or vertex of one placement of a prototype (M7). */
export interface EntityRef {
  kind: EntityKind;
  prototype: number;
  /** The face, edge or vertex number, as in the prototype's ranges and vertices. */
  index: number;
  /** The placement's world transform, column-major 4x4. */
  matrix: readonly number[];
}

export type Xyz = [number, number, number];

/** A part's whole-shape properties, reported with every entity (D104). */
export interface PartMeasure {
  /** 0 for open shells. */
  volume: number;
  area: number;
  centroid: Xyz;
  min?: Xyz;
  max?: Xyz;
}

/** One entity's properties in world coordinates (wrappers/j3d_facade.cpp, describeEntity). */
export type EntityMeasure = (
  | {
      kind: 'face';
      area: number;
      surface: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
      normal?: Xyz;
      radius?: number;
      majorRadius?: number;
      minorRadius?: number;
      semiAngle?: number;
      axis?: Xyz;
      origin?: Xyz;
      centre?: Xyz;
    }
  | {
      kind: 'edge';
      length: number;
      curve: 'line' | 'circle' | 'ellipse' | 'other';
      start?: Xyz;
      end?: Xyz;
      direction?: Xyz;
      radius?: number;
      majorRadius?: number;
      minorRadius?: number;
      centre?: Xyz;
      normal?: Xyz;
    }
  | { kind: 'vertex'; point: Xyz }
) & { anchor: Xyz; part: PartMeasure };

/** Two entities (describePair): what applies of distance, angle and centre distance. */
export interface PairMeasure {
  kind: 'pair';
  distance?: number;
  pointA?: Xyz;
  pointB?: Xyz;
  angleOf?: 'planes' | 'lines' | 'line and plane';
  /** Degrees, 0-90. */
  angle?: number;
  centreDistance?: number;
  centreA?: Xyz;
  centreB?: Xyz;
}

export class OcctMeasureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcctMeasureError';
  }
}

/** What a model can be saved as (M9, D83): the import numbering, in wrappers/j3d_facade.cpp. */
export const ExportFormat = { Step: 0, Brep: 2 } as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

/** Must match the status codes in wrappers/j3d_facade.cpp. */
export const ExportStatus = { Ok: 0, Failed: 1, Empty: 2, OutOfMemory: 3, Internal: 4, Cancelled: 5 } as const;
export type ExportStatus = (typeof ExportStatus)[keyof typeof ExportStatus];

/** STEP translates the model (with a fraction) and then writes it (without one); BREP only writes. */
export const ExportPhase = { Transferring: 2, Writing: 5 } as const;
export type ExportPhase = (typeof ExportPhase)[keyof typeof ExportPhase];

export interface ExportOptions {
  /** Fraction in [0, 1], or a negative number while the phase has no measurable progress. */
  onProgress?: (phase: ExportPhase, fraction: number) => void;
  /** Polled while OCCT works: returning true stops the export with {@link ExportStatus.Cancelled} (D125). */
  isCancelled?: () => boolean;
}

export class OcctExportError extends Error {
  constructor(
    readonly status: ExportStatus,
    message: string,
  ) {
    super(message);
    this.name = 'OcctExportError';
  }
}

/** One piece of an expanded part (M15, D154, D189–D191), as {@link OcctModel.expand} gives them. */
export interface ExpandedPiece {
  /** The name the file gives it, or "" (J3D numbers those, D191). */
  name: string;
  /** An earlier piece, or -1 for the expanded node itself. */
  parent: number;
  /** Index into the scene's prototypes, or -1 for a sub-assembly. */
  prototype: number;
  /** The placement in its parent's frame, column-major 4x4. */
  matrix: number[];
}

/**
 * Objects moved or copied in from another model (M18, D225): their nodes as the facade numbers them
 * from `base` on (after the file's, and any earlier arrival's), in tree order, each parent an earlier
 * node of the arrival or -1.
 */
export interface Arrival {
  base: number;
  nodes: SceneNode[];
}

/**
 * How {@link OcctModel.exportTree} writes each node of an edited tree (M15): reusing its origin's
 * definition whole, or as a new assembly whose children follow.
 */
export const PlanKind = { Reuse: 0, Assembly: 1 } as const;
export type PlanKind = (typeof PlanKind)[keyof typeof PlanKind];

/** A plan node's origin: the file's own (piece {@link FileOrigin}), its expansion (-1) or one of its pieces. */
export const FileOrigin = -2;

/** One node of an export plan, each after its parent (wrappers/j3d_facade.cpp, exportTree). */
export interface PlanNode {
  kind: PlanKind;
  /** An earlier node, or -1 for the top level. */
  parent: number;
  /** The file node it comes from, or -1 for a new assembly of J3D's. */
  ref: number;
  /** {@link FileOrigin}, or with `ref` expanded, -1 for the expansion and a piece index for a piece. */
  piece: number;
  /** The placement in the parent's frame, column-major 4x4: the identity at the top level, but for a part. */
  matrix: readonly number[];
  name: string;
}

/** The plan as the facade reads it: one line per node, "kind parent ref piece matrix\tname". */
export function planText(plan: readonly PlanNode[]): string {
  return plan
    .map(({ kind, parent, ref, piece, matrix, name }) => `${kind} ${parent} ${ref} ${piece} ${matrix.join(',')}\t${name.replace(/[\t\r\n]/g, ' ')}\n`)
    .join('');
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
      check(module, handle, handle.importFile(format, fileName));
      check(
        module,
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

  /** One entity's properties and its part's (D80, D104). Throws {@link OcctMeasureError}. */
  measureEntity(entity: EntityRef): EntityMeasure {
    return parseMeasure(this.live().measureEntity(entity.kind, entity.prototype, entity.index, entity.matrix.join(',')));
  }

  /**
   * Two entities of this model, or `a` of this model and `b` from another model's {@link exportEntity}
   * (D102), whose `prototype` and `index` are then ignored.
   */
  measurePair(a: EntityRef, b: EntityRef, shapeB = ''): PairMeasure {
    return parseMeasure(
      this.live().measurePair(a.kind, a.prototype, a.index, a.matrix.join(','), b.kind, b.prototype, b.index, b.matrix.join(','), shapeB),
    );
  }

  /** An entity as BREP text in its part's own coordinates, for {@link measurePair} in another model. */
  exportEntity(entity: Pick<EntityRef, 'kind' | 'prototype' | 'index'>): string {
    const text = this.live().exportEntity(entity.kind, entity.prototype, entity.index);
    if (text.startsWith('{"error"')) {
      parseMeasure(text);
    }
    return text;
  }

  /**
   * The whole model as imported, as a STEP or BREP file (M9, D83). Runs synchronously; throws
   * {@link OcctExportError}, with status Cancelled when `isCancelled` stopped it. The model stays usable.
   */
  exportFile(format: ExportFormat, options: ExportOptions = {}): Uint8Array<ArrayBuffer> {
    return this.write((handle) => handle.exportFile(format), options);
  }

  private write(run: (handle: J3DModelHandle) => number, options: ExportOptions): Uint8Array<ArrayBuffer> {
    if (!this.handle) {
      throw new OcctExportError(ExportStatus.Internal, 'The model has been disposed.');
    }
    const handle = this.handle;
    const { onProgress, isCancelled } = options;
    this.module.j3dProgress = onProgress ? (phase, fraction) => onProgress(phase as ExportPhase, fraction) : undefined;
    this.module.j3dCancelled = isCancelled;
    try {
      const status = run(handle);
      if (status === ExportStatus.Ok) {
        return readOutput(this.module, handle);
      }
      const nearCeiling = this.module.wasmMemory.buffer.byteLength >= MaximumHeapBytes * OutOfMemoryHeapFraction;
      if (status !== ExportStatus.Cancelled && status !== ExportStatus.OutOfMemory && nearCeiling) {
        throw new OcctExportError(ExportStatus.OutOfMemory, `Out of memory (${handle.getLastError() || 'export failed'}).`);
      }
      throw new OcctExportError(status as ExportStatus, handle.getLastError() || 'Export failed.');
    } finally {
      handle.releaseOutput();
      this.module.j3dProgress = undefined;
      this.module.j3dCancelled = undefined;
    }
  }

  /**
   * Expands file node `node`'s compound part (M15, D154): its pieces, in tree order, with the
   * prototypes they draw extracted and appended to {@link scene}'s. Expanding a node whose definition
   * was expanded before gives the same pieces, and new prototypes only for a style not drawn yet.
   * Throws {@link OcctMeasureError} when there's nothing to expand.
   */
  expand(node: number): { pieces: ExpandedPiece[]; prototypes: PrototypeMesh[] } {
    const handle = this.live();
    const { pieces } = parseMeasure<{ pieces: ExpandedPiece[] }>(handle.expandNode(node));
    const first = this.scene.prototypes.length;
    const prototypes = Array.from({ length: handle.getPrototypeCount() - first }, (_, offset) =>
      extractPrototype(this.module, handle, first + offset),
    );
    this.scene.prototypes.push(...prototypes);
    return { pieces, prototypes };
  }

  /**
   * Reads a STEP another model's worker wrote ({@link exportTree}) as an arrival whose nodes start at
   * node `base` (M18, D225): the file's node count, or after an earlier arrival's; one there already is
   * replaced. The prototypes its parts draw are extracted and appended to {@link scene}'s. Plans,
   * {@link expand} and the queries then name its nodes and prototypes as the file's. Throws
   * {@link OcctMeasureError} when the STEP can't be read.
   */
  async arrive(source: Blob | Uint8Array, base: number): Promise<{ arrival: Arrival; prototypes: PrototypeMesh[] }> {
    const handle = this.live();
    await writeInput(this.module, handle, source, undefined);
    const arrival = parseMeasure<Arrival>(handle.arrive(base));
    const first = this.scene.prototypes.length;
    const prototypes = Array.from({ length: handle.getPrototypeCount() - first }, (_, offset) =>
      extractPrototype(this.module, handle, first + offset),
    );
    this.scene.prototypes.push(...prototypes);
    return { arrival, prototypes };
  }

  /**
   * An edited tree, as a STEP or BREP file (M15, D145, D188–D196), from a plan of its nodes. Runs and
   * fails as {@link exportFile} does.
   */
  exportTree(format: ExportFormat, plan: readonly PlanNode[], options: ExportOptions = {}): Uint8Array<ArrayBuffer> {
    return this.write((handle) => handle.exportTree(format, planText(plan)), options);
  }

  /** WASM heap size of the module this model lives in (one module per worker). */
  get memoryBytes(): number {
    return this.module.wasmMemory.buffer.byteLength;
  }

  dispose(): void {
    this.handle?.delete();
    this.handle = undefined;
  }

  private live(): J3DModelHandle {
    if (!this.handle) {
      throw new OcctMeasureError('The model has been disposed.');
    }
    return this.handle;
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

function check(module: OcctModule, handle: J3DModelHandle, status: number): void {
  if (status === ImportStatus.Ok) {
    return;
  }
  if (status !== ImportStatus.OutOfMemory && module.wasmMemory.buffer.byteLength >= MaximumHeapBytes * OutOfMemoryHeapFraction) {
    throw new OcctImportError(ImportStatus.OutOfMemory, `Out of memory (${handle.getLastError() || 'import failed'}).`);
  }
  throw new OcctImportError(status as ImportStatus, handle.getLastError() || 'Import failed.');
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
      faceRanges: copyUint32(module, data.getFaceRangesPtr(), data.getFaceRangesLength()),
      edgeRanges: copyUint32(module, data.getEdgeRangesPtr(), data.getEdgeRangesLength()),
      vertices: copyFloat32(module, data.getVerticesPtr(), data.getVerticesLength()),
    };
    if (colorsLength > 0) {
      mesh.colors = copyFloat32(module, data.getColorsPtr(), colorsLength);
    }
    return mesh;
  } finally {
    data.delete();
  }
}

/** Copies the export's chunks out of WASM memory into one buffer outside the heap. */
function readOutput(module: OcctModule, handle: J3DModelHandle): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(handle.getOutputLength() >>> 0);
  let offset = 0;
  for (let index = 0; index < handle.getOutputChunkCount(); index++) {
    const length = handle.getOutputChunkLength(index);
    output.set(new Uint8Array(module.wasmMemory.buffer, handle.getOutputChunkPtr(index) >>> 0, length), offset);
    offset += length;
  }
  return output;
}

function parseMeasure<T>(json: string): T {
  const result = JSON.parse(json) as T | { error: string };
  if (typeof result === 'object' && result !== null && 'error' in result) {
    throw new OcctMeasureError(result.error);
  }
  return result;
}

function copyFloat32(module: OcctModule, address: number, length: number): Float32Array {
  return length === 0 ? new Float32Array(0) : new Float32Array(module.wasmMemory.buffer, address >>> 0, length).slice();
}

function copyUint32(module: OcctModule, address: number, length: number): Uint32Array {
  return length === 0 ? new Uint32Array(0) : new Uint32Array(module.wasmMemory.buffer, address >>> 0, length).slice();
}
