// Mesh import paths that run under Node: STL/OBJ parsing (the mesh worker's code), rebuilding, and
// glTF without textures or Draco. Textures and Draco need a browser and are covered by Playwright.

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { BufferGeometry, DoubleSide, Mesh, MeshPhongMaterial, MeshStandardMaterial, Texture, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { ModelFormat } from '../../formats';
import { ModelImportError } from '../errors';
import type { ImportRequest } from '../runner';
import { SidecarSet, type BatchFile } from '../sidecars';
import { describeMeshModel, disposeObject } from './describe';
import { importGltf } from './gltf-import';
import { buildScene } from './mesh-import';
import { toStandardMaterial } from './obj-materials';
import { parseObj, parseStl } from './parse';

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../../../../tests/fixtures/${path}`, import.meta.url)));
const fileOf = (path: string, bytes = fixture(path)) => new File([bytes], path.slice(path.lastIndexOf('/') + 1));

/** Every mesh fixture is the same base-and-post model, Z-up (see scripts/generate-mesh-fixtures.mjs). */
const fixtureBounds = { min: [-20, -15, 0], max: [20, 15, 60] };

/** Within 0.005: meshopt quantises positions. */
function expectFixtureBounds(bounds: { min: number[]; max: number[] }) {
  bounds.min.forEach((value, axis) => expect(value).toBeCloseTo(fixtureBounds.min[axis]!, 2));
  bounds.max.forEach((value, axis) => expect(value).toBeCloseTo(fixtureBounds.max[axis]!, 2));
}

function request(path: string, format: ModelFormat, sidecars: string[] = []): ImportRequest {
  const file = fileOf(path);
  const entries: BatchFile[] = sidecars.map((sidecar) => ({ file: fileOf(sidecar), path: sidecar.slice(sidecar.lastIndexOf('/') + 1) }));
  return { file, fileName: file.name, path: file.name, format, sidecars: new SidecarSet(entries), onProgress: () => {} };
}

describe('parseStl', () => {
  it('reads a binary STL as one non-indexed mesh named after the file', () => {
    const scene = parseStl(fixture('part.stl'), 'part.stl');
    expect(scene.meshes).toHaveLength(1);
    const [mesh] = scene.meshes;
    expect(mesh!.name).toBe('part.stl');
    expect(mesh!.attributes.map((a) => a.name).sort()).toEqual(['normal', 'position']);
    expect(mesh!.attributes.find((a) => a.name === 'position')!.array.length).toBe(24 * 9);
  });

  it('rejects an STL without triangles as Empty', () => {
    const empty = new Uint8Array(84); // 80-byte header, zero triangles
    expect(() => parseStl(empty, 'empty.stl')).toThrow(ModelImportError);
    expect(() => parseStl(empty, 'empty.stl')).toThrow('no geometry');
  });
});

describe('parseObj', () => {
  it('keeps object names and reports no material libraries for a plain OBJ', () => {
    const scene = parseObj(fixture('part.obj'));
    expect(scene.meshes.map((m) => m.name)).toEqual(['Base', 'Post']);
    expect(scene.materialLibraries).toEqual([]);
  });

  it('reports mtllib references and per-object material names', () => {
    const scene = parseObj(fixture('textured/part.obj'));
    expect(scene.materialLibraries).toEqual(['part.mtl']);
    expect(scene.meshes.map((m) => m.materials.map((material) => material.name))).toEqual([['Checker'], ['Glass']]);
    expect(scene.meshes[0]!.attributes.map((a) => a.name)).toContain('uv');
  });
});

describe('buildScene + describeMeshModel', () => {
  it('describes an STL as a single part', () => {
    const root = buildScene(parseStl(fixture('part.stl'), 'part.stl'), 'part.stl');
    const result = describeMeshModel(root, root, 'part.stl', []);

    expect(result.tree).toEqual([{ name: 'part.stl', parent: -1, prototype: 0 }]);
    expect(result.stats).toEqual({ nodes: 1, prototypes: 1, instances: 1, triangles: 24, edges: 0, textures: 0 });
    expect(result.memoryBytes).toBe(2 * 24 * 9 * 4); // positions + normals
    expectFixtureBounds(result.bounds);
  });

  it('describes an OBJ as a file node with one child per object, in neutral grey', () => {
    const root = buildScene(parseObj(fixture('part.obj')), 'part.obj');
    const result = describeMeshModel(root, root, 'part.obj', []);

    expect(result.tree).toEqual([
      { name: 'part.obj', parent: -1, prototype: -1 },
      { name: 'Base', parent: 0, prototype: 0 },
      { name: 'Post', parent: 0, prototype: 1 },
    ]);
    expect(result.stats.triangles).toBe(24);
    expectFixtureBounds(result.bounds);
    const material = (root.children[0] as Mesh).material as Material & { color: { getHexString(): string } };
    expect(material.color.getHexString()).toBe('b4b9c0');
  });

  it('frees geometry and materials on dispose', () => {
    const root = buildScene(parseObj(fixture('part.obj')), 'part.obj');
    const disposed: string[] = [];
    root.traverse((object: Object3D) => {
      if (object instanceof Mesh) {
        (object.geometry as BufferGeometry).addEventListener('dispose', () => disposed.push(`geometry ${object.name}`));
        (object.material as Material).addEventListener('dispose', () => disposed.push(`material ${object.name}`));
      }
    });
    disposeObject(root);
    expect(disposed.sort()).toEqual(['geometry Base', 'geometry Post', 'material Base', 'material Post']);
  });
});

describe('importGltf', () => {
  it.each(['part.glb', 'meshopt.glb'])('loads %s Z-up with its node hierarchy and translucent material', async (path) => {
    const warnings: string[] = [];
    const { root, scene } = await importGltf(request(path, 'gltf'), {}, warnings);
    const result = describeMeshModel(root, scene, path, warnings);

    expect(result.tree.map((node) => node.name)).toEqual(['Scene', 'Assembly', 'Base', 'Post']);
    expect(result.stats).toMatchObject({ prototypes: 2, instances: 2, triangles: 24 });
    expectFixtureBounds(result.bounds); // stored Y-up; rotated to Z-up on import
    const post = scene.getObjectByName('Post') as Mesh;
    expect(post.material).toMatchObject({ transparent: true, opacity: expect.closeTo(0.4, 5) });
    expect(warnings).toEqual([]);
  });

  it('fails with MissingFile when an external buffer was not supplied', async () => {
    const attempt = importGltf(request('multi/scene.gltf', 'gltf', ['multi/checker.png']), {}, []);
    await expect(attempt).rejects.toMatchObject({ code: 'MissingFile', message: expect.stringContaining('"scene.bin"') });
  });

  it('rejects a file that requires an extension three cannot load', async () => {
    const json = JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_future_thing'] });
    const req = { ...request('part.glb', 'gltf'), file: new File([json], 'future.gltf'), fileName: 'future.gltf' };
    await expect(importGltf(req, {}, [])).rejects.toMatchObject({ code: 'Unsupported' });
  });

  it('fails with ParseFailed for a file that is not glTF', async () => {
    const req = { ...request('part.glb', 'gltf'), file: new File(['not json'], 'broken.gltf') };
    await expect(importGltf(req, {}, [])).rejects.toMatchObject({ code: 'ParseFailed' });
  });
});

describe('MTL materials', () => {
  it('become Standard materials that keep colour, texture, opacity and vertex colours (D46)', () => {
    const map = new Texture();
    const phong = new MeshPhongMaterial({ name: 'Glass', color: 0x4d99ff, map, opacity: 0.4, transparent: true, vertexColors: true });
    let disposed = false;
    phong.addEventListener('dispose', () => (disposed = true));

    const standard = toStandardMaterial(phong);

    expect(standard).toBeInstanceOf(MeshStandardMaterial);
    expect(standard).toMatchObject({ name: 'Glass', map, opacity: 0.4, transparent: true, vertexColors: true, side: DoubleSide });
    expect([standard.metalness, standard.roughness]).toEqual([0.05, 0.55]);
    expect(standard.color.getHex()).toBe(0x4d99ff);
    expect(disposed).toBe(true);
  });

  it('are double-sided Standard materials in the neutral grey without an MTL', () => {
    const root = buildScene(parseStl(fixture('part.stl'), 'part.stl'), 'part.stl');
    const material = (root as Mesh).material as MeshStandardMaterial;
    expect(material).toBeInstanceOf(MeshStandardMaterial);
    expect(material.side).toBe(DoubleSide);
  });
});
