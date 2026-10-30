import { FileOrigin, PlanKind, type PlanNode } from '@j3d/occt/facade';
import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../import/types.js';
import { exportPlan, writesAsImported, type PlanSource } from './export-plan.js';
import { ModelStructure, NoEdits, TopLevel, type Expansions, type ModelEdits } from './structure.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shift = (x: number, y = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

/** Plant (0) › Robot (1) › Base (2, part) and Gripper (3, a compound part); Robot (4) › Base (5) and Gripper (6); Guard (7). */
const tree: (TreeNode & { matrix: number[] })[] = [
  { name: 'Plant', parent: -1, prototype: -1, matrix: identity },
  { name: 'Robot', parent: 0, prototype: -1, matrix: shift(100) },
  { name: 'Base', parent: 1, prototype: 0, matrix: identity },
  { name: 'Gripper', parent: 1, prototype: 1, matrix: shift(0, 50) },
  { name: 'Robot', parent: 0, prototype: -1, matrix: shift(200) },
  { name: 'Base', parent: 4, prototype: 0, matrix: identity },
  { name: 'Gripper', parent: 4, prototype: 1, matrix: shift(0, 50) },
  { name: 'Guard', parent: 0, prototype: 2, matrix: shift(300) },
];

interface Setup {
  edits?: ModelEdits;
  expansions?: Expansions;
  moves?: Record<number, number[]>;
  frame?: number[];
  hidden?: number[];
}

function source({ edits = NoEdits, expansions = new Map(), moves = {}, frame = identity, hidden = [] }: Setup = {}): PlanSource {
  const structure = new ModelStructure(tree, edits, expansions);
  return {
    structure,
    fileTree: tree,
    expansions,
    local: (node) => moves[node] ?? tree[node]?.matrix ?? identity,
    frame,
    hidden: new Set(hidden),
  };
}

/** The plan as "kind ref.piece name", each indented under its parent. */
function outline(plan: readonly PlanNode[]): string[] {
  const depth: number[] = [];
  return plan.map((node, i) => {
    depth[i] = node.parent < 0 ? 0 : depth[node.parent]! + 1;
    const origin = node.piece === FileOrigin ? `${node.ref}` : `${node.ref}.${node.piece}`;
    return `${'  '.repeat(depth[i]!)}${node.kind === PlanKind.Reuse ? 'reuse' : 'new'} ${origin} ${node.name}`;
  });
}

describe('exportPlan (M15)', () => {
  it('writes an untouched model as imported', () => {
    expect(writesAsImported(source())).toBe(true);
    expect(writesAsImported(source({ hidden: [7] }))).toBe(false); // D194
    expect(writesAsImported(source({ moves: { 2: shift(1) } }))).toBe(false);
    expect(writesAsImported(source({ frame: shift(5) }))).toBe(false);
    expect(writesAsImported(source({ edits: { ...NoEdits, names: [{ node: 2, name: 'Plate' }] } }))).toBe(false);
  });

  it('reuses the whole file when nothing under the root changed (D188)', () => {
    // The root's own name and place may differ: it's renamed here.
    const plan = exportPlan(source({ edits: { ...NoEdits, names: [{ node: 0, name: 'Factory' }] } }));
    expect(outline(plan)).toEqual(['reuse 0 Factory']);
    expect(plan[0]!.matrix).toEqual(identity);
  });

  it('writes an edited assembly anew and keeps the untouched ones shared (D188)', () => {
    // The first robot's base moved: the plant and that robot are new, the second robot is reused whole.
    const lifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1];
    const plan = exportPlan(source({ moves: { 2: lifted } }));
    expect(outline(plan)).toEqual(['new 0 Plant', '  new 1 Robot', '    reuse 2 Base', '    reuse 3 Gripper', '  reuse 4 Robot', '  reuse 7 Guard']);
    expect(plan[1]!.matrix).toEqual(shift(100));
    expect(plan[2]!.matrix[14]).toBe(5);
  });

  it('writes a renamed part in a new assembly, and its own rename on the reused one above it', () => {
    const renamed = exportPlan(source({ edits: { ...NoEdits, names: [{ node: 5, name: 'Plate' }, { node: 4, name: 'Spare' }] } }));
    expect(outline(renamed)).toEqual(['new 0 Plant', '  reuse 1 Robot', '  new 4 Spare', '    reuse 5 Plate', '    reuse 6 Gripper', '  reuse 7 Guard']);
  });

  it('leaves out hidden parts, and assemblies left with nothing (D194, D195)', () => {
    const plan = exportPlan(source({ hidden: [2, 3, 7] }));
    expect(outline(plan)).toEqual(['new 0 Plant', '  reuse 4 Robot']);
  });

  it("writes copies anew, from their sources' definitions (D188)", () => {
    // A copy of the second robot (8, with 9 and 10) at the top level, beside the plant.
    const edits: ModelEdits = { ...NoEdits, added: [4, 5, 6], children: [{ parent: TopLevel, nodes: [0, 8] }, { parent: 8, nodes: [9, 10] }] };
    const plan = exportPlan(source({ edits, moves: { 8: shift(200), 9: identity, 10: shift(0, 50) } }));
    expect(outline(plan)).toEqual(['reuse 0 Plant', 'new 4 Robot', '  reuse 5 Base', '  reuse 6 Gripper']);
    // A top-level assembly's placement goes into its children.
    expect(plan[1]!.matrix).toEqual(identity);
    expect(plan[2]!.matrix).toEqual(shift(200));
    expect(plan[3]!.matrix).toEqual(shift(200, 50));
  });

  it("puts the model's frame into the top level: a part takes it, an assembly's children do", () => {
    const plan = exportPlan(source({ frame: shift(10) }));
    expect(outline(plan)).toEqual(['new 0 Plant', '  reuse 1 Robot', '  reuse 4 Robot', '  reuse 7 Guard']);
    expect(plan[1]!.matrix).toEqual(shift(110));
    // The Guard alone at the top level, moved: it takes its own placement.
    const top = { ...NoEdits, children: [{ parent: TopLevel, nodes: [7] }, { parent: 0, nodes: [1, 4] }] };
    const alone = exportPlan(source({ edits: top, frame: shift(10) }), new Set([7]));
    expect(outline(alone)).toEqual(['reuse 7 Guard']);
    expect(alone[0]!.matrix).toEqual(shift(310));
  });

  it('writes a selection under its assembly path, without unselected siblings (D155)', () => {
    const plan = exportPlan(source(), new Set([3]));
    expect(outline(plan)).toEqual(['new 0 Plant', '  new 1 Robot', '    reuse 3 Gripper']);
    // A whole robot selected is still the file's robot.
    expect(outline(exportPlan(source(), new Set([5, 6])))).toEqual(['new 0 Plant', '  reuse 4 Robot']);
    expect(exportPlan(source({ hidden: [3] }), new Set([3]))).toEqual([]);
  });

  describe('with Expand', () => {
    const pieces = (named: boolean) =>
      new Map([
        [
          3,
          [
            { name: named ? 'Jaw' : '', parent: -1, prototype: 3, matrix: shift(1) },
            { name: named ? 'Jaw' : '', parent: -1, prototype: 3, matrix: shift(2) },
          ],
        ],
      ]);
    // The first robot's Gripper (3) expanded: its assembly (8) with jaws 9 and 10.
    const expanded: ModelEdits = {
      ...NoEdits,
      added: [-1, -1, -1],
      children: [
        { parent: 1, nodes: [2, 8] },
        { parent: 8, nodes: [9, 10] },
      ],
      pieces: [
        { node: 8, expands: 3, piece: -1, name: 'Gripper', part: false },
        { node: 9, expands: 3, piece: 0, name: 'Jaw', part: true },
        { node: 10, expands: 3, piece: 1, name: 'Jaw', part: true },
      ],
    };
    // Where the viewer puts them: the assembly where the part was, the jaws as the part has them.
    const moves = { 8: shift(0, 50), 9: shift(1), 10: shift(2) };

    it("reuses an expansion whole when its pieces have the file's names", () => {
      const plan = exportPlan(source({ edits: expanded, expansions: pieces(true), moves }));
      expect(outline(plan)).toEqual(['new 0 Plant', '  new 1 Robot', '    reuse 2 Base', '    reuse 3.-1 Gripper', '  reuse 4 Robot', '  reuse 7 Guard']);
    });

    it("writes an expansion's pieces when J3D named them (D191), or one moved", () => {
      const numbered: ModelEdits = { ...expanded, pieces: expanded.pieces!.map((piece, i) => (i > 0 ? { ...piece, name: `Gripper ${i}` } : piece)) };
      const plan = exportPlan(source({ edits: numbered, expansions: pieces(false), moves }));
      expect(outline(plan).slice(3, 6)).toEqual(['    new 3.-1 Gripper', '      reuse 3.0 Gripper 1', '      reuse 3.1 Gripper 2']);
      const moved = exportPlan(source({ edits: expanded, expansions: pieces(true), moves: { ...moves, 10: shift(9) } }));
      expect(outline(moved).slice(3, 6)).toEqual(['    new 3.-1 Gripper', '      reuse 3.0 Jaw', '      reuse 3.1 Jaw']);
      expect(moved[5]!.matrix).toEqual(shift(9));
    });
  });
});
