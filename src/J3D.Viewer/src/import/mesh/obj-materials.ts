import { LoadingManager, type Material } from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import type { ImportRequest } from '../runner';
import { SidecarUrls } from './sidecar-urls';

export interface ObjMaterials {
  /** The MTL material of that name, or undefined when no supplied library defines it. */
  create(name: string): Material | undefined;
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

  return creators.length === 0
    ? undefined
    : {
        create: (name) => {
          const creator = creators.find((c) => c.materialsInfo[name] !== undefined);
          return creator?.create(name);
        },
      };
}
