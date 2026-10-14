import { DoubleSide, LoadingManager, MeshStandardMaterial, type Material, type MeshPhongMaterial } from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SurfaceMetalness, SurfaceRoughness } from '../../view/surface';
import type { ImportRequest } from '../runner';
import { SidecarUrls } from './sidecar-urls';

export interface ObjMaterials {
  /** The MTL material of that name, or undefined when no supplied library defines it. */
  create(name: string): Material | undefined;
}

/**
 * MTLLoader makes Phong materials, which ignore the viewer's image-based lighting. They become the
 * same Standard material as everything else, keeping their colour, textures, opacity and vertex
 * colours (decision D46). Specular colour and shininess are dropped.
 */
export function toStandardMaterial(phong: MeshPhongMaterial): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: phong.name,
    color: phong.color,
    map: phong.map,
    emissive: phong.emissive,
    emissiveMap: phong.emissiveMap,
    alphaMap: phong.alphaMap,
    bumpMap: phong.bumpMap,
    bumpScale: phong.bumpScale,
    normalMap: phong.normalMap,
    normalScale: phong.normalScale,
    opacity: phong.opacity,
    transparent: phong.transparent,
    alphaTest: phong.alphaTest,
    vertexColors: phong.vertexColors,
    flatShading: phong.flatShading,
    metalness: SurfaceMetalness,
    roughness: SurfaceRoughness,
    side: DoubleSide,
  });
  phong.dispose(); // its textures now belong to the new material
  return material;
}

/**
 * Loads the OBJ's `mtllib` libraries from the batch's sidecars, along with their textures. A missing
 * library or texture is a warning, not an error (docs/plan.md §12).
 */
export async function loadObjMaterials(libraries: readonly string[], request: ImportRequest, warnings: string[]): Promise<ObjMaterials | undefined> {
  const creators: MTLLoader.MaterialCreator[] = [];
  for (const library of new Set(libraries)) {
    const sidecar = request.sidecars.find(library, request.path);
    if (!sidecar) {
      warnings.push(`Material library "${library}" wasn't supplied, so default materials are used.`);
      continue;
    }

    const urls = new SidecarUrls(request.sidecars, sidecar.path, warnings);
    const manager = new LoadingManager();
    manager.setURLModifier(urls.modifier);
    const texturesLoaded = new Promise<void>((resolve) => (manager.onLoad = resolve));
    const creator = new MTLLoader(manager).parse(await sidecar.file.text(), '');
    creator.preload(); // creates every material and starts its texture loads
    if (urls.used) {
      await texturesLoaded;
    }
    urls.revoke();
    creators.push(creator);
  }

  if (creators.length === 0) {
    return undefined;
  }
  const converted = new Map<string, Material>();
  return {
    create: (name) => {
      let material = converted.get(name);
      if (!material) {
        const phong = creators.find((c) => c.materialsInfo[name] !== undefined)?.create(name);
        material = phong && toStandardMaterial(phong as MeshPhongMaterial);
        if (material) {
          converted.set(name, material);
        }
      }
      return material;
    },
  };
}
