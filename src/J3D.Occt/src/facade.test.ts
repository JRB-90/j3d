// Integration tests: the real OCCT WebAssembly build (dist/) under Node, importing the committed
// fixtures in tests/fixtures (see scripts/generate-fixtures.mjs).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from '../dist/j3d_occt_single.js';
import {
  ImportFormat,
  ImportPhase,
  ImportStatus,
  OcctImportError,
  OcctModel,
  type ImportedScene,
  type OcctModule,
  type PrototypeMesh,
} from './facade';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));

let oc: OcctModule;

beforeAll(async () => {
  oc = await init();
});

async function load(name: string, format: ImportFormat): Promise<ImportedScene> {
  using model = await OcctModel.load(oc, fixture(name), format, name);
  return model.scene;
}

function triangleCount(mesh: PrototypeMesh) {
  return mesh.indices.length / 3;
}

function expectWellFormed(mesh: PrototypeMesh) {
  const vertexCount = mesh.positions.length / 3;
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.opaqueIndexCount % 3).toBe(0);
  expect(mesh.opaqueIndexCount).toBeLessThanOrEqual(mesh.indices.length);
  expect(Math.max(...mesh.indices)).toBeLessThan(vertexCount);
  expect(mesh.edges.length % 6).toBe(0);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    expect(Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!)).toBeCloseTo(1, 3);
  }
}

describe('BREP', () => {
  it('imports a plain box as one uncoloured part with 12 straight edges', async () => {
    const scene = await load('box.brep', ImportFormat.Brep);

    expect(scene.nodes).toEqual([{ name: 'box.brep', parent: -1, prototype: 0 }]);
    expect(scene.instances).toHaveLength(1);
    expect(scene.prototypes).toHaveLength(1);

    const [box] = scene.prototypes as [PrototypeMesh];
    expectWellFormed(box);
    expect(triangleCount(box)).toBe(12); // 6 planar faces x 2 triangles
    expect(box.edges.length).toBe(12 * 6); // 12 edges, one segment each
    expect(box.colors).toBeUndefined();
    expect(box.uniformColor[3]).toBe(1);

    const xs = box.positions.filter((_, i) => i % 3 === 0);
    const zs = box.positions.filter((_, i) => i % 3 === 2);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([0, 10, 0, 30]);
  });
});

describe('STEP', () => {
  it('reads per-face colours over a part colour', async () => {
    const scene = await load('coloured-part.step', ImportFormat.Step);

    expect(scene.nodes.map((node) => node.name)).toContain('Coloured block');
    const [part] = scene.prototypes as [PrototypeMesh];
    expectWellFormed(part);
    expect(part.colors).toBeDefined();

    // Top face (z = 20) red, the rest blue. Colours are linear RGB.
    const colors = part.colors!;
    for (let v = 0; v < part.positions.length / 3; v++) {
      const [r, , b] = [colors[v * 4]!, colors[v * 4 + 1]!, colors[v * 4 + 2]!];
      const onTop = Math.abs(part.positions[v * 3 + 2]! - 20) < 1e-6;
      if (onTop && r > b) {
        expect(r).toBeCloseTo(0.8, 2);
      } else {
        expect(b).toBeGreaterThan(r);
      }
    }
  });

  it('keeps assembly structure and meshes a repeated part once', async () => {
    const scene = await load('assembly.step', ImportFormat.Step);

    const names = scene.nodes.map((node) => node.name);
    expect(names).toEqual(expect.arrayContaining(['Bracket assembly', 'Plate (bottom)', 'Plate (top)', 'Pin']));
    const root = scene.nodes.findIndex((node) => node.name === 'Bracket assembly');
    expect(scene.nodes[root]!.prototype).toBe(-1);
    expect(scene.nodes.filter((node) => node.parent === root)).toHaveLength(3);

    expect(scene.instances).toHaveLength(3);
    expect(scene.prototypes).toHaveLength(2); // both plates share one prototype
    scene.prototypes.forEach(expectWellFormed);

    const topPlate = scene.nodes.findIndex((node) => node.name === 'Plate (top)');
    const instance = scene.instances.find((i) => i.node === topPlate)!;
    expect(instance.matrix.slice(12, 15)).toEqual([0, 0, 35]); // column-major translation
  });

  it('separates translucent faces and keeps their alpha', async () => {
    const scene = await load('translucent.step', ImportFormat.Step);

    const cover = scene.prototypes.find((p) => p.uniformColor[3] < 1)!;
    const core = scene.prototypes.find((p) => p.uniformColor[3] === 1)!;
    expect(cover.uniformColor[3]).toBeCloseTo(0.4, 2);
    expect(cover.opaqueIndexCount).toBe(0);
    expect(cover.indices.length).toBeGreaterThan(0);
    expect(core.opaqueIndexCount).toBe(core.indices.length);
  });

  it('reports progress through every C++ phase', async () => {
    const phases = new Set<number>();
    using _ = await OcctModel.load(oc, fixture('assembly.step'), ImportFormat.Step, 'assembly.step', {
      onProgress: (phase) => phases.add(phase),
    });
    expect([...phases].sort()).toEqual([
      ImportPhase.Reading,
      ImportPhase.Parsing,
      ImportPhase.Transferring,
      ImportPhase.Meshing,
      ImportPhase.Extracting,
    ]);
  });

  it('rejects an invalid file with ParseFailed', async () => {
    const attempt = load('invalid.step', ImportFormat.Step);
    await expect(attempt).rejects.toBeInstanceOf(OcctImportError);
    await expect(attempt).rejects.toMatchObject({ status: ImportStatus.ParseFailed });
  });

  it('streams Blob input the same as bytes', async () => {
    const bytes = fixture('assembly.step');
    using model = await OcctModel.load(oc, new Blob([bytes]), ImportFormat.Step, 'assembly.step');
    expect(model.scene.instances).toHaveLength(3);
  });
});

describe('IGES', () => {
  it('imports a coloured surface model', async () => {
    const scene = await load('surfaces.iges', ImportFormat.Iges);

    expect(scene.prototypes.length).toBeGreaterThan(0);
    scene.prototypes.forEach(expectWellFormed);
    const [r, g, b] = scene.prototypes[0]!.uniformColor;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});
