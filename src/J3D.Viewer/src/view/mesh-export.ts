// The GLB and STL writers (M9), loaded with the first mesh export: three's exporters aren't needed before.

import type { Object3D, Texture, WebGLRenderer } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { decompress } from 'three/addons/utils/WebGLTextureUtils.js';
import { J3dGltfMarker } from '../import/mesh/j3d-gltf';

/** GLB, or STL in binary or ASCII (D127). */
export type MeshExportFormat = 'glb' | 'stl' | 'stl-ascii';

/**
 * Writes a scene built by `buildExportScene`. A GLB carries J3D's marker in `asset.extras` (D123); with
 * a renderer, compressed (KTX2) textures are decompressed to be written. STL is one uncoloured solid of
 * every mesh's triangles, in world coordinates.
 */
export async function writeMeshFile(scene: Object3D, format: MeshExportFormat, renderer?: WebGLRenderer): Promise<Uint8Array<ArrayBuffer>> {
  if (format === 'glb') {
    const exporter = new GLTFExporter().register((writer) => ({
      afterParse() {
        // three's types don't declare the writer's JSON.
        (writer as unknown as { json: { asset: Record<string, unknown> } }).json.asset['extras'] = { ...J3dGltfMarker };
      },
    }));
    if (renderer) {
      // The exporter writes the texture this returns (three's types say void).
      exporter.setTextureUtils({ decompress: (texture: Texture, maxTextureSize?: number) => decompress(texture, maxTextureSize, renderer) });
    }
    const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
    return new Uint8Array(glb as ArrayBuffer);
  }
  const stl = new STLExporter().parse(scene, { binary: format === 'stl' });
  return typeof stl === 'string' ? new TextEncoder().encode(stl) : new Uint8Array(stl.buffer, stl.byteOffset, stl.byteLength);
}
