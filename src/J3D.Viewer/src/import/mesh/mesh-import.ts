import {
  DoubleSide,
  Group,
  LineBasicMaterial,
  Material,
  MeshStandardMaterial,
  PointsMaterial,
  type Object3D,
} from 'three';
import { NeutralGrey, SurfaceMetalness, SurfaceRoughness } from '../../view/surface.js';
import { ModelImportError } from '../errors.js';
import type { MeshWorkerRequest, MeshWorkerResponse, WorkerMeshFormat } from '../protocol.js';
import { liveWorkers, type ImportRequest, type ImportRunner } from '../runner.js';
import type { ImportResult } from '../types.js';
import { describeMeshModel, disposeObject } from './describe.js';
import { importGltf, type GltfImportOptions } from './gltf-import.js';
import { loadObjMaterials, type ObjMaterials } from './obj-materials.js';
import { buildObject, type SerializedMaterial, type SerializedMeshScene, type SerializedObjectKind } from './serialize.js';

export type MeshRunnerOptions = GltfImportOptions;

/** Neutral grey for meshes without a colour of their own, as for BREP parts (decision D46). */
export const DefaultMeshColor = NeutralGrey;

/**
 * Mesh formats: STL and OBJ are parsed in a transient mesh worker and rebuilt here; glTF loads on the
 * main thread. Loaded once, on the first mesh import (see runners.ts).
 */
export function createMeshRunner(options: MeshRunnerOptions): ImportRunner {
  return (request) => {
    let disposed = false;
    let root: Object3D | undefined;
    let releaseWorker: (() => void) | undefined;

    const result = (async (): Promise<ImportResult> => {
      const warnings: string[] = [];
      let scene: Object3D;
      let unitScale = 1;
      if (request.format === 'gltf') {
        ({ root, scene, unitScale } = await importGltf(request, options, warnings));
      } else {
        const parsed = await parseInWorker(request, (release) => (releaseWorker = release));
        releaseWorker?.();
        const materials = request.format === 'obj' ? await loadObjMaterials(parsed.materialLibraries, request, warnings) : undefined;
        scene = buildScene(parsed, request.fileName, materials);
        root = scene; // STL and OBJ are Z-up already (docs/plan.md §6.2)
      }

      if (disposed) {
        disposeObject(root);
        return new Promise<never>(() => {});
      }
      return describeMeshModel(root, scene, request.fileName, warnings, unitScale);
    })();

    return {
      result,
      dispose() {
        disposed = true;
        releaseWorker?.();
        if (root) {
          disposeObject(root);
          root = undefined;
        }
      },
    };
  };
}

function parseInWorker(request: ImportRequest, onWorker: (release: () => void) => void): Promise<SerializedMeshScene> {
  const worker = new Worker(new URL('../workers/mesh-worker.ts', import.meta.url), {
    type: 'module',
    name: `J3D mesh: ${request.fileName}`,
  });
  onWorker(liveWorkers.track(worker));
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<MeshWorkerResponse>) => {
      switch (data.type) {
        case 'progress':
          request.onProgress(data.phase, data.fraction);
          break;
        case 'parsed':
          resolve(data.scene);
          break;
        case 'failed':
          reject(new ModelImportError(data.error.code, data.error.message));
          break;
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new ModelImportError('Internal', event.message || 'The mesh worker stopped unexpectedly.'));
    };
    const message: MeshWorkerRequest = {
      type: 'parse',
      file: request.file,
      fileName: request.fileName,
      format: request.format as WorkerMeshFormat,
    };
    worker.postMessage(message);
  });
}

/** A single mesh (STL) is its own root; OBJ objects go under a group named after the file. */
export function buildScene(parsed: SerializedMeshScene, fileName: string, materials?: ObjMaterials): Object3D {
  const objects = parsed.meshes.map((mesh) => buildObject(mesh, (material, kind) => materialFor(material, kind, materials)));
  if (objects.length === 1 && parsed.materialLibraries.length === 0 && objects[0]!.name === fileName) {
    return objects[0]!;
  }
  const group = new Group();
  group.name = fileName;
  group.add(...objects);
  return group;
}

function materialFor(source: SerializedMaterial, kind: SerializedObjectKind, library: ObjMaterials | undefined): Material {
  const fromLibrary = source.name ? library?.create(source.name) : undefined;
  if (fromLibrary && kind === 'mesh') {
    return fromLibrary;
  }

  const colour = source.vertexColors ? 0xffffff : DefaultMeshColor;
  const transparency = { opacity: source.opacity, transparent: source.opacity < 1 };
  const material =
    kind === 'lines'
      ? new LineBasicMaterial({ color: colour, vertexColors: source.vertexColors, ...transparency })
      : kind === 'points'
        ? new PointsMaterial({ color: colour, vertexColors: source.vertexColors, size: 1, sizeAttenuation: false, ...transparency })
        : new MeshStandardMaterial({
            color: colour,
            vertexColors: source.vertexColors,
            flatShading: source.flatShading,
            metalness: SurfaceMetalness,
            roughness: SurfaceRoughness,
            // STL and OBJ files often mix up their triangles' winding.
            side: DoubleSide,
            ...transparency,
          });
  if (fromLibrary) {
    // An MTL colour on a line or point object, as OBJLoader does.
    Material.prototype.copy.call(material, fromLibrary);
    (material as LineBasicMaterial).color.copy((fromLibrary as MeshStandardMaterial).color);
  }
  material.name = source.name;
  return material;
}
