import { Group, LoadingManager, type Object3D, type WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { ModelImportError, toImportError } from '../errors';
import type { ImportRequest } from '../runner';
import { SidecarUrls } from './sidecar-urls';

/**
 * The Draco and Basis decoders need no configuration: three's loaders locate them with
 * `new URL(…, import.meta.url)`, so Vite emits them next to the bundle and they're served from the
 * same origin, as COEP requires (no CDN).
 */
export interface GltfImportOptions {
  /** The renderer KTX2 textures are transcoded for. Without one, {@link probeTextureSupport} asks the GPU directly. */
  getRenderer?: () => WebGLRenderer;
}

/** Extensions three's GLTFLoader implements (r186), so a file that requires any other is rejected up front. */
const loaderExtensions = new Set([
  'KHR_binary_glTF',
  'KHR_draco_mesh_compression',
  'KHR_lights_punctual',
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
  'KHR_texture_transform',
  'EXT_materials_bump',
  'EXT_mesh_gpu_instancing',
  'EXT_meshopt_compression',
  'EXT_texture_avif',
  'EXT_texture_webp',
]);

interface GltfJson {
  asset?: { version?: string };
  buffers?: { uri?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

/**
 * Loads a GLB or `.gltf` with three's GLTFLoader on the main thread (it needs the DOM for textures),
 * serving external buffers and textures from the batch's sidecars (docs/plan.md §6.2). Returns the
 * model rotated from glTF's Y-up to Z-up, and the file's own scene inside it.
 */
export async function importGltf(
  request: ImportRequest,
  options: GltfImportOptions,
  warnings: string[],
): Promise<{ root: Object3D; scene: Object3D }> {
  request.onProgress('reading', 0);
  const data = await request.file.arrayBuffer();
  request.onProgress('reading', 1);
  request.onProgress('parsing', null);

  const json = readJson(data);
  const unsupported = (json.extensionsRequired ?? []).filter((name) => !loaderExtensions.has(name));
  if (unsupported.length > 0) {
    throw new ModelImportError('Unsupported', `The file requires glTF extensions J3D doesn't support: ${unsupported.join(', ')}.`);
  }
  const missing = (json.buffers ?? [])
    .map((buffer) => buffer.uri)
    .filter((uri): uri is string => uri !== undefined && !uri.startsWith('data:') && !request.sidecars.find(uri, request.path));
  if (missing.length > 0) {
    throw new ModelImportError(
      'MissingFile',
      `${request.fileName} needs ${missing.map((uri) => `"${uri}"`).join(', ')}. Select or drop it together with the model.`,
    );
  }

  const urls = new SidecarUrls(request.sidecars, request.path, warnings);
  const manager = new LoadingManager();
  manager.setURLModifier(urls.modifier);
  const loader = new GLTFLoader(manager);
  const used = new Set(json.extensionsUsed ?? []);
  let draco: DRACOLoader | undefined;
  let ktx2: KTX2Loader | undefined;
  try {
    if (used.has('KHR_draco_mesh_compression')) {
      draco = new DRACOLoader(manager);
      loader.setDRACOLoader(draco);
    }
    if (used.has('KHR_texture_basisu')) {
      ktx2 = new KTX2Loader(manager);
      detectKtx2Support(ktx2, options);
      loader.setKTX2Loader(ktx2);
    }
    if (used.has('EXT_meshopt_compression') || used.has('KHR_meshopt_compression')) {
      loader.setMeshoptDecoder(MeshoptDecoder);
    }

    const gltf = await loader.parseAsync(data, '');
    // Lights and cameras belong to the file's own presentation, not to the model.
    gltf.scene.traverse((object) => {
      if ((object as { isLight?: boolean }).isLight || (object as { isCamera?: boolean }).isCamera) {
        object.removeFromParent();
      }
    });

    const root = new Group();
    root.name = request.fileName;
    root.rotation.x = Math.PI / 2; // glTF is Y-up; J3D is Z-up (decision D18)
    root.add(gltf.scene);
    return { root, scene: gltf.scene };
  } catch (error) {
    const { code, message } = toImportError(error);
    throw new ModelImportError(code === 'Internal' ? 'ParseFailed' : code, message);
  } finally {
    urls.revoke();
    draco?.dispose();
    ktx2?.dispose();
  }
}

function readJson(data: ArrayBuffer): GltfJson {
  try {
    const view = new DataView(data);
    const isBinary = data.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67; // "glTF"
    // GLB: 12-byte header, then the JSON chunk (length, type "JSON", data).
    const text = isBinary
      ? new TextDecoder().decode(new Uint8Array(data, 20, view.getUint32(12, true)))
      : new TextDecoder().decode(data);
    const json = JSON.parse(text) as GltfJson;
    if (typeof json !== 'object' || json === null || typeof json.asset !== 'object') {
      throw new Error('missing asset');
    }
    return json;
  } catch {
    throw new ModelImportError('ParseFailed', 'Not a readable glTF file.');
  }
}

function detectKtx2Support(loader: KTX2Loader, options: GltfImportOptions): void {
  loader.detectSupport(options.getRenderer?.() ?? (probeTextureSupport() as WebGLRenderer));
}

/**
 * The part of a WebGL renderer that `KTX2Loader.detectSupport` reads (its extensions), taken from a
 * throwaway WebGL2 context. Without WebGL at all (headless Firefox in CI, for one), no compressed
 * format is supported and the transcoder falls back to uncompressed RGBA rather than failing.
 */
export function probeTextureSupport(): Pick<WebGLRenderer, 'extensions'> {
  const supported = new Map<string, unknown>();
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl) {
    for (const name of gl.getSupportedExtensions() ?? []) {
      supported.set(name, undefined);
    }
    // detectSupport asks the ASTC extension for its profiles; answer from a snapshot, since the
    // context is lost below.
    const astc = gl.getExtension('WEBGL_compressed_texture_astc');
    if (astc) {
      const profiles = astc.getSupportedProfiles();
      supported.set('WEBGL_compressed_texture_astc', { getSupportedProfiles: () => profiles });
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  const extensions = { has: (name: string) => supported.has(name), get: (name: string) => supported.get(name) };
  return { extensions } as unknown as Pick<WebGLRenderer, 'extensions'>;
}
