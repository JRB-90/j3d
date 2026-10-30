// STL and OBJ parsing for the mesh worker (and Vitest under Node: nothing here needs the DOM).

import { LineSegments, Points, type BufferGeometry, type Material, type Object3D } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ModelImportError } from '../errors.js';
import { serializeGeometry, type SerializedMaterial, type SerializedMeshScene } from './serialize.js';

export function parseStl(bytes: Uint8Array, fileName: string): SerializedMeshScene {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  const geometry = new STLLoader().parse(buffer as ArrayBuffer) as BufferGeometry & { hasColors?: boolean; alpha?: number };
  const material: SerializedMaterial = {
    name: '',
    vertexColors: geometry.hasColors === true,
    flatShading: false,
    opacity: geometry.alpha ?? 1,
  };
  return requireGeometry({ meshes: [serializeGeometry(fileName, 'mesh', geometry, [material])], materialLibraries: [] });
}

export function parseObj(bytes: Uint8Array): SerializedMeshScene {
  const group = new OBJLoader().parse(new TextDecoder().decode(bytes)) as ReturnType<OBJLoader['parse']> & {
    materialLibraries?: string[];
  };
  const meshes = group.children.map((child: Object3D) => {
    const object = child as Object3D & { geometry: BufferGeometry; material: Material | Material[] };
    const kind = object instanceof LineSegments ? 'lines' : object instanceof Points ? 'points' : 'mesh';
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(
      (material): SerializedMaterial => ({
        name: material.name,
        vertexColors: material.vertexColors,
        flatShading: (material as Material & { flatShading?: boolean }).flatShading === true,
        opacity: material.opacity,
      }),
    );
    return serializeGeometry(object.name, kind, object.geometry, materials);
  });
  return requireGeometry({ meshes, materialLibraries: group.materialLibraries ?? [] });
}

function requireGeometry(scene: SerializedMeshScene): SerializedMeshScene {
  const hasVertices = scene.meshes.some((mesh) => (mesh.attributes.find((a) => a.name === 'position')?.array.length ?? 0) > 0);
  if (!hasVertices) {
    throw new ModelImportError('Empty', 'The file contains no geometry.');
  }
  return scene;
}
