import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../import/types';
import { EditsMismatchError, hasEdits, ModelStructure, NoEdits, sameEdits, TopLevel, type ModelEdits } from './structure';

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
  });
});
