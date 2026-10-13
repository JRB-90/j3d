/**
 * Supported import formats. This module is the single source of truth for file-extension detection;
 * .NET receives the lowercase format name (see J3D.Web.Client/Models/ModelFormat.cs).
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

export const supportedExtensions: readonly string[] = [...formatsByExtension.keys()];

/** Value for an <c>&lt;input type="file" accept="…"&gt;</c> attribute. */
export const fileInputAccept: string = supportedExtensions.join(',');

export function detectFormat(fileName: string): ModelFormat | undefined {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? undefined : formatsByExtension.get(fileName.slice(dot).toLowerCase());
}

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
