import type { Arrival, ImportedScene, PrototypeMesh, SceneNode } from '@j3d/occt/facade';
import { describe, expect, it } from 'vitest';
import type { ModelContent } from '../import/types.js';
import { addArrival, arrivalsOf, readArrivals } from './arrive.js';
import { arrivalBase, EditsMismatchError, ModelStructure, TopLevel, type KeptArrival, type ModelEdits } from './structure.js';

const node = (parent: number, prototype: number, name = ''): SceneNode => ({ name, parent, prototype, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 0, 0, 1] });
/** What each file arrives as: J3D's assembly, then an assembly with one part. */
const arrivals: Record<string, SceneNode[]> = {
  'a.step': [node(-1, -1), node(0, -1, 'Top'), node(1, 0, 'Plate')],
  'b.step': [node(-1, -1), node(0, 0, 'Pin')],
};

/** A BREP model's content whose worker reads arrivals in, as the facade does, noting each base it's asked for. */
function brep(): { content: ModelContent; asked: [string, number][] } {
  const asked: [string, number][] = [];
  const scene: ImportedScene = { nodes: [node(-1, -1, 'Bracket')], instances: [], prototypes: [] };
  const content: ModelContent = {
    kind: 'brep',
    scene,
    arriver: {
      arrive: async (file, base) => {
        const name = await file.text();
        asked.push([name, base]);
        const nodes = arrivals[name]!.map((each) => ({ ...each, prototype: each.prototype >= 0 ? scene.prototypes.length : -1 }));
        const arrival: Arrival = { base, nodes };
        return { arrival, prototypes: [{} as PrototypeMesh] };
      },
    },
  };
  return { content, asked };
}

const kept = (...files: string[]): KeptArrival[] => files.map((file) => ({ file, nodes: arrivals[file]!.length }));

describe('arrivals (M18, D225)', () => {
  it('are numbered after the file’s nodes and each earlier arrival’s', () => {
    expect(arrivalBase(5, kept('a.step', 'b.step'), 0)).toBe(5);
    expect(arrivalBase(5, kept('a.step', 'b.step'), 1)).toBe(8);
  });

  it('are read in once, in order, a restored model’s from its kept files', async () => {
    const { content, asked } = brep();
    const read = (file: string) => Promise.resolve(new Blob([file]));

    await readArrivals(content, 1, kept('a.step', 'b.step'), read);
    await readArrivals(content, 1, kept('a.step', 'b.step'), read);

    expect(asked).toEqual([
      ['a.step', 1],
      ['b.step', 4],
    ]);
    expect([...arrivalsOf(content).keys()]).toEqual(['a.step', 'b.step']);
    expect(content.kind === 'brep' && content.scene.prototypes).toHaveLength(2);
  });

  it('read one in again where an undo and a newer arrival replaced it', async () => {
    const { content, asked } = brep();
    const read = (file: string) => Promise.resolve(new Blob([file]));
    await addArrival(content, 1, [], 'a.step', new Blob(['a.step']));
    // Undone, then b arrived in its place: the facade's a is gone.
    await addArrival(content, 1, [], 'b.step', new Blob(['b.step']));
    // A redo of a after undoing b reads it in again from the bytes it came with.
    await readArrivals(content, 1, kept('a.step'), () => Promise.reject(new Error('not read from the store')));

    expect(asked).toEqual([
      ['a.step', 1],
      ['b.step', 1],
      ['a.step', 1],
    ]);
    await expect(readArrivals(content, 1, [...kept('a.step'), { file: 'c.step', nodes: 2 }], read)).rejects.toThrow(EditsMismatchError);
  });

  it('join the tree as added nodes, placed in the model’s frame or their arrival parent’s', async () => {
    const { content } = brep();
    await addArrival(content, 1, [], 'a.step', new Blob(['a.step']));
    const edits: ModelEdits = {
      added: [-1, -1],
      children: [
        { parent: TopLevel, nodes: [0, 1] },
        { parent: 1, nodes: [2] },
      ],
      names: [],
      arrivals: kept('a.step'),
      arrived: [
        { node: 1, arrival: 0, index: 1, name: 'Top', part: false },
        { node: 2, arrival: 0, index: 2, name: 'Plate', part: true },
      ],
    };

    const structure = new ModelStructure([node(-1, -1, 'Bracket')], edits, new Map(), arrivalsOf(content));

    expect(structure.parts()).toEqual([2]);
    expect(structure.nodes[2]).toMatchObject({ name: 'Plate', parent: 1, prototype: 0 });
    expect(structure.arrivalFrame(1)).toMatchObject({ parent: TopLevel });
    expect(structure.arrivalFrame(2)).toMatchObject({ parent: 1 });
    expect(structure.sourceNodes).toEqual([0, 2, 3]); // the facade's numbers: after the file's one node
    expect(structure.addedKey(2)).toBe('aa.step:2');
    expect(() => new ModelStructure([node(-1, -1)], edits, new Map(), new Map())).toThrow(EditsMismatchError);
    expect(() => new ModelStructure([node(-1, -1)], { ...edits, arrived: [{ node: 1, arrival: 0, index: 5, name: '', part: false }] })).toThrow(EditsMismatchError);
  });
});
