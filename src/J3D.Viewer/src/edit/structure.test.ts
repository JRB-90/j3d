import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../import/types';
import { EditsMismatchError, expandedFileNodes, hasEdits, ModelStructure, NoEdits, sameEdits, TopLevel, type ModelEdits } from './structure';

/** root (0) › a (1, part) and sub (2) › b (3, part) and c (4, part); and a second root, d (5, part). */
const tree: TreeNode[] = [
  { name: 'root', parent: -1, prototype: -1 },
  { name: 'a', parent: 0, prototype: 0 },
  { name: 'sub', parent: 0, prototype: -1 },
  { name: 'b', parent: 2, prototype: 1 },
  { name: 'c', parent: 2, prototype: 1 },
  { name: 'd', parent: -1, prototype: 2 },
];

const edits = (changes: Partial<ModelEdits>): ModelEdits => ({ ...NoEdits, ...changes });

describe('ModelStructure (M14)', () => {
  it('is the file tree when there are no edits', () => {
    const structure = new ModelStructure(tree);
    expect(structure.count).toBe(6);
    expect(structure.childrenOf(TopLevel)).toEqual([0, 5]);
    expect(structure.childrenOf(2)).toEqual([3, 4]);
    expect(structure.order()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(structure.parts()).toEqual([1, 3, 4, 5]);
    expect(structure.nodes[3]).toEqual({ name: 'b', parent: 2, prototype: 1 });
  });

  it('moves a node to another parent with both child lists, and keeps the order given', () => {
    const structure = new ModelStructure(tree, edits({ children: [{ parent: 2, nodes: [4] }, { parent: 0, nodes: [3, 1, 2] }] }));
    expect(structure.nodes[3]!.parent).toBe(0);
    expect(structure.order()).toEqual([0, 3, 1, 2, 4, 5]);
  });

  it('adds copies that draw their sources, named as the file names them, and new assemblies', () => {
    // Copy sub (6) with b (7) and c (8) to the top level; then group d and the copy under a new assembly (9).
    const structure = new ModelStructure(
      tree,
      edits({
        added: [2, 3, 4, -1],
        children: [
          { parent: 6, nodes: [7, 8] },
          { parent: 9, nodes: [5, 6] },
          { parent: TopLevel, nodes: [0, 9] },
        ],
        names: [{ node: 9, name: 'Assembly 1' }],
      }),
    );
    expect(structure.nodes.slice(6)).toEqual([
      { name: 'sub', parent: 9, prototype: -1 },
      { name: 'b', parent: 6, prototype: 1 },
      { name: 'c', parent: 6, prototype: 1 },
      { name: 'Assembly 1', parent: TopLevel, prototype: -1 },
    ]);
    expect(structure.sources.slice(6)).toEqual([2, 3, 4, -1]);
    expect(structure.fileNodes.slice(6)).toEqual([2, 3, 4, -1]);
    expect(structure.order()).toEqual([0, 1, 2, 3, 4, 9, 5, 6, 7, 8]);
    expect(structure.parts()).toEqual([1, 3, 4, 5, 7, 8]);
  });

  it('follows a copy of a copy back to the file node it draws', () => {
    const structure = new ModelStructure(tree, edits({ added: [1, 6], children: [{ parent: 0, nodes: [1, 2, 6, 7] }] }));
    expect(structure.fileNodes.slice(6)).toEqual([1, 1]);
    expect(structure.nodes[7]).toEqual({ name: 'a', parent: 0, prototype: 0 });
  });

  it('removes a node left out of every list, with everything under it, and renames', () => {
    const structure = new ModelStructure(tree, edits({ children: [{ parent: 0, nodes: [1] }], names: [{ node: 1, name: 'renamed' }] }));
    expect([2, 3, 4].map((node) => structure.isLive(node))).toEqual([false, false, false]);
    expect(structure.isPart(3)).toBe(false);
    expect(structure.order()).toEqual([0, 1, 5]);
    expect(structure.nodes[1]!.name).toBe('renamed');
    expect(structure.nodes[2]!.parent).toBe(0); // where it was
    expect(structure.subtree(2)).toEqual([2, 3, 4]);
  });

  it.each([
    ['a copy of a later node', edits({ added: [7, 1] })],
    ['a copy of a node that does not exist', edits({ added: [-2] })],
    ['a list for a node that does not exist', edits({ children: [{ parent: 6, nodes: [] }] })],
    ['a list with a node that does not exist', edits({ children: [{ parent: 0, nodes: [1, 2, 9] }] })],
    ['a node in two lists', edits({ children: [{ parent: 0, nodes: [1, 2, 3] }] })],
    ['a node inside itself', edits({ children: [{ parent: 0, nodes: [1] }, { parent: 3, nodes: [2] }] })],
    ['a name for a node that does not exist', edits({ names: [{ node: 6, name: 'x' }] })],
  ])('rejects %s (R25)', (_, wrong) => {
    expect(() => new ModelStructure(tree, wrong)).toThrow(EditsMismatchError);
  });

  it('compares edits by value', () => {
    expect(hasEdits(NoEdits)).toBe(false);
    expect(hasEdits(edits({ names: [{ node: 0, name: 'x' }] }))).toBe(true);
    expect(sameEdits(undefined, NoEdits)).toBe(true);
    expect(sameEdits(edits({ added: [1] }), edits({ added: [1] }))).toBe(true);
    expect(sameEdits(edits({ added: [1] }), edits({ added: [2] }))).toBe(false);
    expect(sameEdits(edits({ added: [1] }), edits({ added: [1], pieces: [] }))).toBe(true); // edits kept before M15
  });
});

describe('ModelStructure with Expand (M15)', () => {
  const shift = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
  // Part d (5) expands into a sub-assembly (piece 0) of two solids (1, 2) and a third solid (3).
  const expansions = new Map([
    [
      5,
      [
        { name: '', parent: -1, prototype: -1, matrix: shift(1) },
        { name: 'Left', parent: 0, prototype: 3, matrix: shift(2) },
        { name: '', parent: 0, prototype: 4, matrix: shift(3) },
        { name: '', parent: -1, prototype: 4, matrix: shift(4) },
      ],
    ],
  ]);
  // d's assembly (6), then the pieces (7–10), in d's place at the top level.
  const expanded = edits({
    added: [-1, -1, -1, -1, -1],
    children: [
      { parent: TopLevel, nodes: [0, 6] },
      { parent: 6, nodes: [7, 10] },
      { parent: 7, nodes: [8, 9] },
    ],
    pieces: [
      { node: 6, expands: 5, piece: -1, name: 'd', part: false },
      { node: 7, expands: 5, piece: 0, name: 'd 1', part: false },
      { node: 8, expands: 5, piece: 1, name: 'Left', part: true },
      { node: 9, expands: 5, piece: 2, name: 'd 1 2', part: true },
      { node: 10, expands: 5, piece: 3, name: 'd 2', part: true },
    ],
  });

  it("puts an expanded part's pieces in its place, drawing the expansion's prototypes", () => {
    const structure = new ModelStructure(tree, expanded, expansions);
    expect(structure.isLive(5)).toBe(false);
    expect(structure.order()).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10]);
    expect(structure.nodes.slice(6).map(({ name, prototype }) => [name, prototype])).toEqual([
      ['d', -1],
      ['d 1', -1],
      ['Left', 3],
      ['d 1 2', 4],
      ['d 2', 4],
    ]);
    expect(structure.fileNodes.slice(6)).toEqual([-1, -1, -1, -1, -1]);
    expect(structure.expansionOf(6)).toMatchObject({ expands: 5, piece: -1 });
    // Each piece goes in its piece parent's frame, as the part has it.
    expect(structure.pieceFrame(6)).toBeUndefined();
    expect(structure.pieceFrame(7)).toEqual({ parent: 6, matrix: shift(1) });
    expect(structure.pieceFrame(9)).toEqual({ parent: 7, matrix: shift(3) });
    expect(structure.addedKey(9)).toBe('p5:2');
    expect(structure.addedKey(6)).toBe('p5:-1');
  });

  it("names a piece's copy as the piece, and draws its prototype", () => {
    const copied = edits({
      ...expanded,
      added: [...expanded.added, 9],
      children: [...expanded.children.filter(({ parent }) => parent !== 6), { parent: 6, nodes: [7, 10, 11] }],
    });
    const structure = new ModelStructure(tree, copied, expansions);
    expect(structure.nodes[11]).toEqual({ name: 'd 1 2', parent: 6, prototype: 4 });
    expect(structure.addedKey(11)).toBe('c9');
  });

  it('needs the expansions of the parts it expands, in order of first use', () => {
    expect(expandedFileNodes(tree.length, expanded)).toEqual([5]);
    // A copy of d (6), expanded: its file part is d's.
    expect(expandedFileNodes(tree.length, edits({ added: [5, -1], pieces: [{ node: 7, expands: 6, piece: -1, name: 'd', part: false }] }))).toEqual([5]);
    expect(expandedFileNodes(tree.length, NoEdits)).toEqual([]);
  });

  it.each([
    ['no expansion of the part', new Map()],
    ['a piece the expansion lacks', new Map([[5, expansions.get(5)!.slice(0, 3)]])],
    ['a part that is an assembly there', new Map([[5, expansions.get(5)!.map((piece, i) => (i === 1 ? { ...piece, prototype: -1 } : piece))]])],
  ])('rejects %s (R25)', (_, wrong) => {
    expect(() => new ModelStructure(tree, expanded, wrong)).toThrow(EditsMismatchError);
  });

  it.each([
    ['a piece that is a copy', edits({ ...expanded, added: [-1, 5, -1, -1, -1] })],
    ['a piece expanding a later node', edits({ ...expanded, pieces: [{ node: 6, expands: 8, piece: -1, name: 'd', part: false }] })],
    ['an expanded assembly', edits({ added: [-1], pieces: [{ node: 6, expands: 2, piece: -1, name: 'sub', part: false }] })],
  ])('rejects %s (R25)', (_, wrong) => {
    expect(() => new ModelStructure(tree, wrong, expansions)).toThrow(EditsMismatchError);
  });
});
