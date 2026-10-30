/**
 * Supported import formats. This module is the single source of truth for file-extension detection;
 * .NET receives the lowercase format name (see J3D.Blazor/Models/ModelFormat.cs).
 */
export type ModelFormat = 'step' | 'iges' | 'brep' | 'stl' | 'obj' | 'gltf';

/** BREP models go through OCCT; mesh models go through Three.js loaders. */
export type ModelKind = 'brep' | 'mesh';

const formatsByExtension: ReadonlyMap<string, ModelFormat> = new Map<string, ModelFormat>([
  ['.step', 'step'],
  ['.stp', 'step'],
  ['.iges', 'iges'],
  ['.igs', 'iges'],
  ['.brep', 'brep'],
  ['.stl', 'stl'],
  ['.obj', 'obj'],
  ['.gltf', 'gltf'],
  ['.glb', 'gltf'],
]);

/** The file extensions the viewer imports, in lower case, each with its dot. */
export const supportedExtensions: readonly string[] = [...formatsByExtension.keys()];

/**
 * Files that are only used next to a model that references them: glTF buffers, OBJ material
 * libraries and textures (docs/plan.md §6.2, sidecar grouping).
 */
export const sidecarExtensions: readonly string[] = ['.bin', '.mtl', '.png', '.jpg', '.jpeg', '.webp', '.ktx2'];

/** Value for an <c>&lt;input type="file" accept="…"&gt;</c> attribute. */
export const fileInputAccept: string = [...supportedExtensions, ...sidecarExtensions].join(',');

/** The lowercase extension including the dot, or an empty string. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

/** The format a file's name says it is, if it's one the viewer imports. */
export function detectFormat(fileName: string): ModelFormat | undefined {
  return formatsByExtension.get(extensionOf(fileName));
}

export function isSidecar(fileName: string): boolean {
  return sidecarExtensions.includes(extensionOf(fileName));
}

/** Whether a format is read by the kernel (`brep`) or as a mesh. */
export function kindOf(format: ModelFormat): ModelKind {
  switch (format) {
    case 'step':
    case 'iges':
    case 'brep':
      return 'brep';
    case 'stl':
    case 'obj':
    case 'gltf':
      return 'mesh';
  }
}
