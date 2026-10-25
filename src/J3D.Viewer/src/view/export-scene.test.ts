// GLB and STL export (M9): the export scene (scene or selection, hidden parts left out, millimetres,
// shared prototypes, BREP edges) and round trips through three's exporters and J3D's own importers.

/// <reference types="node" />

import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import { readFileSync } from 'node:fs';
import { Box3, Group, LineSegments, Matrix4, Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelStructure } from '../edit/structure';
import type { ModelFormat } from '../formats';
import { describeMeshModel } from '../import/mesh/describe';
import { importGltf } from '../import/mesh/gltf-import';
import { isJ3dEdges } from '../import/mesh/j3d-gltf';
import { buildScene } from '../import/mesh/mesh-import';
import { parseStl } from '../import/mesh/parse';
import type { ImportRequest } from '../import/runner';
import { SidecarSet } from '../import/sidecars';
import type { ImportResult } from '../import/types';
import { buildBrepObject } from './brep-object';
import { buildExportScene, exportFileName, type ExportSource } from './export-scene';
import { MaterialCache } from './materials';
import { writeMeshFile } from './mesh-export';

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../../../../tests/fixtures/${path}`, import.meta.url)));

beforeAll(() => {
  // GLTFExporter reads its GLB back through FileReader, which Node doesn't have.
  class NodeFileReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader ??= NodeFileReader as unknown as typeof FileReader;
});

const translated = (x: number, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** A unit square of two triangles in z = 0, with one edge; per-vertex colours make the second triangle translucent. */
function square(colours = false): PrototypeMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    opaqueIndexCount: colours ? 3 : 6,
    ...(colours ? { colors: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0.5, 0, 0, 1, 0.5]) } : {}),
    uniformColor: [0.2, 0.4, 0.6, 1],
    edges: new Float32Array([0, 0, 0, 1, 0, 0]),
    faceRanges: new Uint32Array([0, 3, 3, 3]),
    edgeRanges: new Uint32Array([0, 2]),
    vertices: new Float32Array([0, 0, 0, 1, 0, 0]),
  };
}

/** An assembly of two placements of one plate and a coloured pin: nodes 1-3 are parts. */
function bracket(): ImportedScene {
  return {
    nodes: [
      { name: 'Bracket assembly', parent: -1, prototype: -1 },
      { name: 'Plate (bottom)', parent: 0, prototype: 0 },
      { name: 'Plate (top)', parent: 0, prototype: 0 },
      { name: 'Pin', parent: 0, prototype: 1 },
    ],
    instances: [
      { node: 1, prototype: 0, matrix: translated(0) },
      { node: 2, prototype: 0, matrix: translated(0, 0, 35) },
      { node: 3, prototype: 1, matrix: translated(10, 20, 0) },
    ],
    prototypes: [square(), square(true)],
  };
}

function brepSource(options: Partial<ExportSource> = {}): ExportSource {
  const scene = bracket();
  return { name: 'bracket.step', tree: scene.nodes, content: { kind: 'brep', scene }, hidden: new Set(), selected: [], unitScale: 1, ...options };
}

function request(fileName: string, bytes: Uint8Array<ArrayBuffer>, format: ModelFormat = 'gltf'): ImportRequest {
  return { file: new File([bytes], fileName), fileName, path: fileName, format, sidecars: new SidecarSet([]), onProgress: () => {} };
}

function meshSource(name: string, model: ImportResult, options: Partial<ExportSource> = {}): ExportSource {
  if (model.content.kind !== 'mesh') {
    throw new Error('not a mesh model');
  }
  return {
    name,
    tree: model.tree,
    content: { kind: 'mesh', nodes: model.content.nodes, sceneRoot: name.endsWith('.glb') },
    hidden: new Set(),
    selected: [],
    unitScale: model.content.unitScale ?? 1,
    ...options,
  };
}

async function importGlb(fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<ImportResult> {
  const { root, scene, unitScale } = await importGltf(request(fileName, bytes), {}, []);
  return describeMeshModel(root, scene, fileName, [], unitScale);
}

const names = (object: Object3D): unknown => ({ name: object.name, children: object.children.filter((c) => !isJ3dEdges(c)).map(names) });
const boundsOf = (object: Object3D) => new Box3().setFromObject(object);

describe('buildExportScene', () => {
  it('exports parts where a move put them (M13): from the instance matrices a move rewrites', () => {
    const scene = bracket();
    const placements = [translated(0), translated(0), translated(0, 0, 35), translated(10, 20, 0)];
    scene.nodes.forEach((node, index) => (node.matrix = placements[index]!));
    const { parts } = buildBrepObject('bracket.step', scene, new MaterialCache());
    parts.setPlacement(0, new Matrix4().makeTranslation(100, 0, 0));

    const built = buildExportScene([brepSource({ content: { kind: 'brep', scene } })], false, 'gltf');
    const [, top, pin] = (built.scene.children[0] as Group).children as [Mesh, Mesh, Mesh];

    expect(top.matrixWorld.elements.slice(12, 15)).toEqual([100, 0, 35]);
    expect(pin.matrixWorld.elements.slice(12, 15)).toEqual([110, 20, 0]);
    built.dispose();
  });

  it('exports the tree as edited (M14): a copy, a new assembly holding a moved part, and nothing removed', () => {
    const scene = bracket();
    const placements = [translated(0), translated(0), translated(0, 0, 35), translated(10, 20, 0)];
    scene.nodes.forEach((node, index) => (node.matrix = placements[index]!));
    const { parts } = buildBrepObject('bracket.step', scene, new MaterialCache());
    // Copy the pin (4), group it with the top plate under "Fixings" (5), and remove the bottom plate.
    const structure = new ModelStructure(scene.nodes, {
      added: [3, -1],
      children: [
        { parent: 0, nodes: [3, 5] },
        { parent: 5, nodes: [2, 4] },
      ],
      names: [{ node: 5, name: 'Fixings' }],
    });
    parts.setStructure(structure);

    const built = buildExportScene([brepSource({ tree: structure.nodes, order: structure.order(), content: { kind: 'brep', scene: parts.exportScene() } })], false, 'gltf');

    expect(names(built.scene.children[0]!)).toEqual({
      name: 'Bracket assembly',
      children: [
        { name: 'Pin', children: [] },
        {
          name: 'Fixings',
          children: [
            { name: 'Plate (top)', children: [] },
            { name: 'Pin', children: [] },
          ],
        },
      ],
    });
    const [pin, fixings] = (built.scene.children[0] as Group).children as [Mesh, Group];
    expect((fixings.children[1] as Mesh).matrixWorld.elements.slice(12, 15)).toEqual(pin.matrixWorld.elements.slice(12, 15));
    built.dispose();
  });

  it("keeps a BREP model's tree, placing every part and sharing each prototype's geometry", () => {
    const built = buildExportScene([brepSource()], false, 'gltf');
    const [assembly] = built.scene.children as [Group];

    expect(built.models).toEqual(['bracket.step']);
    expect(names(assembly)).toEqual({
      name: 'Bracket assembly',
      children: [
        { name: 'Plate (bottom)', children: [] },
        { name: 'Plate (top)', children: [] },
        { name: 'Pin', children: [] },
      ],
    });
    const [bottom, top, pin] = assembly.children as [Mesh, Mesh, Mesh];
    expect(top.geometry).toBe(bottom.geometry);
    expect(top.matrixWorld.elements[14]).toBe(35);
    expect(pin.material).toHaveLength(2); // opaque and translucent ranges
    const edges = top.children[0] as LineSegments;
    expect(edges).toBeInstanceOf(LineSegments);
    expect(edges.userData).toEqual({ j3d: 'edges' });
    built.dispose();
  });

  it('leaves out hidden parts, and takes only the selection when asked', () => {
    const scene = buildExportScene([brepSource({ hidden: new Set([2]) })], false, 'gltf').scene;
    expect((names(scene.children[0]!) as { children: { name: string }[] }).children.map((c) => c.name)).toEqual(['Plate (bottom)', 'Pin']);

    const selection = buildExportScene([brepSource({ selected: [3] }), brepSource({ name: 'other.step' })], true, 'gltf');
    expect(selection.models).toEqual(['bracket.step']);
    expect(names(selection.scene.children[0]!)).toEqual({ name: 'Bracket assembly', children: [{ name: 'Pin', children: [] }] });

    expect(buildExportScene([brepSource({ hidden: new Set([1, 2, 3]) })], false, 'gltf').models).toEqual([]);
  });

  it('puts each of several models in a group named after its file', () => {
    const built = buildExportScene([brepSource(), brepSource({ name: 'copy.step' })], false, 'gltf');
    expect(built.scene.children.map((child) => child.name)).toEqual(['bracket.step', 'copy.step']);
    expect(built.models).toEqual(['bracket.step', 'copy.step']);
  });

  it('draws no edges for STL', () => {
    const { scene } = buildExportScene([brepSource()], false, 'stl');
    let lines = 0;
    scene.traverse((object) => (lines += object instanceof LineSegments ? 1 : 0));
    expect(lines).toBe(0);
  });

  it('scales glTF models to millimetres (D118), Z-up as J3D shows them (D122)', async () => {
    const model = await importGlb('part.glb', fixture('part.glb'));
    model.content.kind === 'mesh' && model.content.root.updateMatrixWorld(true);
    const { scene } = buildExportScene([meshSource('part.glb', model)], false, 'gltf');

    expect(scene.name).toBe('Scene'); // the file's scene, so it comes back as it was
    expect(scene.children.map((child) => child.name)).toEqual(['Assembly']);
    const bounds = boundsOf(scene);
    expect(bounds.min.toArray()).toEqual([-20000, -15000, 0].map((v) => expect.closeTo(v, 1)));
    expect(bounds.max.toArray()).toEqual([20000, 15000, 60000].map((v) => expect.closeTo(v, 1)));
  });
});

describe('exportFileName (D128)', () => {
  it("uses the model's name when everything comes from one model", () => {
    expect(exportFileName(['bracket.step'], false, 'glb')).toBe('bracket.glb');
    expect(exportFileName(['part.v2.stl'], true, 'stl')).toBe('part.v2.stl');
    expect(exportFileName(['a.step', 'b.stl'], false, 'stl')).toBe('scene.stl');
    expect(exportFileName(['a.step', 'b.stl'], true, 'glb')).toBe('selection.glb');
  });
});

describe('GLB round trip', () => {
  it("brings J3D's GLB back as exported: Z-up, millimetres, names, colours, edges with their parts (D122-D124)", async () => {
    const built = buildExportScene([brepSource({ hidden: new Set([1]) })], false, 'gltf');
    const exported = boundsOf(built.scene);
    const bytes = await writeMeshFile(built.scene, 'glb');
    built.dispose();

    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer).getUint32(12, true)))) as {
      asset: { extras?: unknown };
      meshes: unknown[];
    };
    expect(json.asset.extras).toEqual({ unit: 'mm', up: 'z' });

    const model = await importGlb('bracket.glb', bytes);
    expect(model.tree.map((node) => node.name)).toEqual(['bracket.glb', 'Bracket assembly', 'Plate (top)', 'Pin']);
    expect(model.tree.map((node) => node.prototype)).toEqual([-1, -1, 0, 1]);
    expect(model.stats).toMatchObject({ triangles: 4, edges: 0 });
    expect(model.content.kind === 'mesh' && (model.content.unitScale ?? 1)).toBe(1); // millimetres (D123)
    expect(model.bounds.min).toEqual(exported.min.toArray().map((v) => expect.closeTo(v, 5)));
    expect(model.bounds.max).toEqual(exported.max.toArray().map((v) => expect.closeTo(v, 5)));

    const nodes = model.content.kind === 'mesh' ? model.content.nodes : [];
    const pin = nodes[3] as Mesh;
    // Its opaque and translucent faces, joined back into one part, and its edges.
    expect(pin.geometry.groups.map(({ count, materialIndex }) => [count, materialIndex])).toEqual([
      [3, 0],
      [3, 1],
    ]);
    const [opaque, translucent] = pin.material as MeshStandardMaterial[];
    expect(opaque).toMatchObject({ transparent: false, vertexColors: true });
    expect(translucent).toMatchObject({ transparent: true, vertexColors: true });
    expect(pin.children).toHaveLength(1);
    expect(isJ3dEdges(pin.children[0]!)).toBe(true);
    expect(pin.matrixWorld.elements.slice(12, 15)).toEqual([10, 20, 0]);
  });

  it('brings a glTF model back with its tree, a thousand times larger in model units', async () => {
    const original = await importGlb('part.glb', fixture('part.glb'));
    const built = buildExportScene([meshSource('part.glb', original)], false, 'gltf');
    const bytes = await writeMeshFile(built.scene, 'glb');

    const again = await importGlb('part.glb', bytes);
    expect(again.tree).toEqual(original.tree);
    expect(again.stats).toEqual(original.stats);
    again.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo(original.bounds.max[axis]! * 1000, 0));
  });
});

describe('STL', () => {
  it.each([
    ['stl', 'binary'],
    ['stl-ascii', 'ASCII'],
  ] as const)('writes every visible triangle as %s (%s), in millimetres', async (format, _encoding) => {
    const stl = buildScene(parseStl(fixture('part.stl'), 'part.stl'), 'part.stl');
    const part = describeMeshModel(stl, stl, 'part.stl', []);
    const built = buildExportScene([brepSource(), meshSource('part.stl', part)], false, 'stl');
    const expected = boundsOf(built.scene);
    const bytes = await writeMeshFile(built.scene, format);

    if (format === 'stl-ascii') {
      expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('solid ');
    }
    const again = buildScene(parseStl(bytes, 'scene.stl'), 'scene.stl');
    const triangles = ((again as Mesh).geometry.getAttribute('position').count) / 3;
    expect(triangles).toBe(3 * 2 + 24);
    const bounds = boundsOf(again);
    expect(bounds.min.toArray()).toEqual(expected.min.toArray().map((v) => expect.closeTo(v, 4)));
    expect(bounds.max.toArray()).toEqual(expected.max.toArray().map((v) => expect.closeTo(v, 4)));
  });
});
