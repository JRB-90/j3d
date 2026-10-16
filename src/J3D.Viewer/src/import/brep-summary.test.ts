import type { ImportedScene, PrototypeMesh } from '@j3d/occt/facade';
import { describe, expect, it } from 'vitest';
import { sceneTransferables, summariseBrepScene } from './brep-summary';

/** A unit cube prototype: 8 corners, 12 triangles, 3 edge segments. */
function cube(): PrototypeMesh {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]);
  return {
    positions,
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(36),
    opaqueIndexCount: 36,
    uniformColor: [1, 1, 1, 1],
    edges: new Float32Array(18),
    faceRanges: new Uint32Array(0),
    edgeRanges: new Uint32Array(0),
    vertices: new Float32Array(0),
  };
}

const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
// 90° about Z: (x, y) → (-y, x)
const rotateZ90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('summariseBrepScene', () => {
  it('bounds every instance in world space and counts drawn triangles and edges', () => {
    const scene: ImportedScene = {
      nodes: [
        { name: 'Assembly', parent: -1, prototype: -1 },
        { name: 'A', parent: 0, prototype: 0 },
        { name: 'B', parent: 0, prototype: 0 },
      ],
      instances: [
        { node: 1, prototype: 0, matrix: translate(10, 0, 5) },
        { node: 2, prototype: 0, matrix: rotateZ90 },
      ],
      prototypes: [cube()],
    };

    const { bounds, stats } = summariseBrepScene(scene);
    expect(bounds).toEqual({ min: [-1, 0, 0], max: [11, 1, 6] });
    expect(stats).toEqual({ nodes: 3, prototypes: 1, instances: 2, triangles: 24, edges: 6, textures: 0 });
  });

  it('gives empty bounds for a scene without vertices', () => {
    const empty = { ...cube(), positions: new Float32Array(0) };
    const scene: ImportedScene = { nodes: [], instances: [{ node: 0, prototype: 0, matrix: translate(5, 5, 5) }], prototypes: [empty] };
    expect(summariseBrepScene(scene).bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

describe('sceneTransferables', () => {
  it('lists every buffer, including optional vertex colours', () => {
    const plain = cube();
    const coloured = { ...cube(), colors: new Float32Array(32) };
    expect(sceneTransferables({ nodes: [], instances: [], prototypes: [plain, coloured] })).toHaveLength(15); // 7 arrays each, and the colours
  });
});
