import { FileOrigin, PlanKind, type PlanNode } from '@j3d/occt/facade';
import type { TreeNode } from '../import/types.js';
import { hasEdits, TopLevel, type Expansions, type ModelStructure } from './structure.js';

/** What a BREP model's STEP or BREP export is planned from (M15). */
export interface PlanSource {
  structure: ModelStructure;
  /** The file's nodes, with their placements in their parents' frames. */
  fileTree: readonly (TreeNode & { matrix?: number[] })[];
  expansions: Expansions;
  /** A node's placement in its parent's frame now, column-major. */
  local(node: number): readonly number[];
  /** The model's frame (D169). */
  frame: readonly number[];
  /** Hidden part nodes (D194). */
  hidden: ReadonlySet<number>;
}

const Identity: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function samePlacement(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => Math.abs(value - b[i]!) <= 1e-9 * Math.max(1, Math.abs(value)));
}

/** Column-major 4x4 product a × b. */
export function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Whether the model writes as imported: no edits, nothing moved or hidden (D188, D194). */
export function writesAsImported(source: PlanSource): boolean {
  const { structure, fileTree } = source;
  return (
    !hasEdits(structure.edits) &&
    source.hidden.size === 0 &&
    samePlacement(source.frame, Identity) &&
    fileTree.every((node, index) => samePlacement(source.local(index), node.matrix ?? Identity))
  );
}

/**
 * The plan of a BREP model's edited tree for the facade's exportTree (M15, D145, D155, D188–D196):
 * the parts shown (and of those, the selected ones when there's a selection), and the assemblies on
 * their paths from the top level, each after its parent. A subtree that's as the file has it (the
 * same children in the same places, none renamed, hidden or left out) reuses the file's definition
 * whole, so what's shared stays shared; an expanded part's assembly reuses its expansion the same way
 * when its pieces all have the file's names. Everything else is written as new assemblies around the
 * file's parts. An assembly with nothing in it is left out (D195). A top-level node's placement, with
 * the model's frame, goes into its children for an assembly, since XCAF can't place a top-level
 * assembly; a part takes it itself. Empty when there's nothing to write.
 */
export function exportPlan(source: PlanSource, selection?: ReadonlySet<number>): PlanNode[] {
  const { structure } = source;
  const writer = planWriter(source, (part) => !source.hidden.has(part) && (selection?.has(part) ?? true));
  for (const node of structure.childrenOf(TopLevel)) {
    if (writer.included(node)) {
      writer.emit(node, -1, multiply(source.frame, source.local(node)));
    }
  }
  return writer.plan;
}

/**
 * The plan of objects going to another model (M18, D225, D229): an assembly of J3D's holding each
 * object with everything under it, hidden parts included, at the placement given (the object's place in
 * the target model's frame, D228). Written as {@link exportPlan} writes, so a subtree as the file has it
 * stays one definition. The other model reads it in as an arrival (the facade's arrive), whose node 0
 * is this assembly and whose other nodes are `order`'s: the nodes written, the objects' subtrees in tree
 * order (an assembly with nothing under it isn't written, D195).
 */
export function transferPlan(
  source: PlanSource,
  objects: readonly { node: number; matrix: readonly number[] }[],
): { plan: PlanNode[]; order: number[] } {
  const { structure } = source;
  const under = new Set(objects.flatMap(({ node }) => structure.subtree(node).filter((child) => structure.isLive(child))));
  const writer = planWriter(source, (part) => under.has(part));
  writer.plan.push({ kind: PlanKind.Assembly, parent: -1, ref: -1, piece: FileOrigin, matrix: Identity, name: '' });
  const order: number[] = [];
  const visit = (node: number) => {
    if (writer.included(node)) {
      order.push(node);
      structure.childrenOf(node).forEach(visit);
    }
  };
  for (const { node, matrix } of objects) {
    if (writer.included(node)) {
      writer.emit(node, 0, matrix);
      visit(node);
    }
  }
  return { plan: writer.plan, order };
}

/** Writes plan lines for nodes of a model's tree: the parts `write` takes, and the assemblies holding any of them. */
function planWriter(source: PlanSource, write: (part: number) => boolean) {
  const { structure, fileTree, expansions } = source;
  const fileCount = fileTree.length;
  const renamed = new Set(structure.edits.names.map(({ node }) => node));

  // Parts written, and assemblies with any of them under them.
  const included = new Uint8Array(structure.count);
  const order = structure.order();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]!;
    if (structure.nodes[node]!.prototype >= 0) {
      included[node] = write(node) ? 1 : 0;
    } else {
      included[node] = structure.childrenOf(node).some((child) => included[child] === 1) ? 1 : 0;
    }
  }

  // Each node's origin: a file node (or since M18 an arrived one, which the facade numbers after the
  // file's), a piece of an expansion, or (-1) none; copies take their source's.
  const origins = new Map<number, { ref: number; piece: number }>();
  const originOf = (node: number): { ref: number; piece: number } => {
    let origin = origins.get(node);
    if (!origin) {
      const expanded = structure.expansionOf(node);
      const copied = structure.sources[node] ?? -1;
      origin =
        node < fileCount || structure.arrivalOf(node)
          ? { ref: structure.sourceNodes[node]!, piece: FileOrigin }
          : expanded
            ? { ref: structure.sourceNodes[expanded.expands]!, piece: expanded.piece }
            : copied >= 0
              ? originOf(copied)
              : { ref: -1, piece: FileOrigin };
      origins.set(node, origin);
    }
    return origin;
  };

  // The file's children of each node, and the nodes Expand made of each expanded part's pieces.
  const fileChildren = new Map<number, number[]>();
  fileTree.forEach((node, index) => {
    if (node.parent >= 0 && node.parent < index) {
      const list = fileChildren.get(node.parent);
      if (list) {
        list.push(index);
      } else {
        fileChildren.set(node.parent, [index]);
      }
    }
  });
  const pieceNodes = new Map<string, number>();
  for (const { node, expands, piece } of structure.edits.pieces ?? []) {
    pieceNodes.set(`${expands}:${piece}`, node);
  }

  // The file's or an expansion's own children of a node that's its origin's, with their placements.
  const originalChildren = (node: number): { nodes: number[]; matrices: (readonly number[])[]; named: boolean } | undefined => {
    if (node < fileCount) {
      const nodes = fileChildren.get(node) ?? [];
      return { nodes, matrices: nodes.map((child) => fileTree[child]!.matrix ?? Identity), named: true };
    }
    const expanded = structure.expansionOf(node);
    const pieces = expanded ? expansions.get(structure.sourceNodes[expanded.expands]!) : undefined;
    if (!expanded || !pieces) {
      return undefined;
    }
    const indices = pieces.flatMap((piece, index) => (piece.parent === expanded.piece ? [index] : []));
    return {
      nodes: indices.map((index) => pieceNodes.get(`${expanded.expands}:${index}`) ?? -1),
      matrices: indices.map((index) => pieces[index]!.matrix),
      named: indices.every((index) => pieces[index]!.name !== ''),
    };
  };

  // As the file (or the expansion) has it, below the node itself, whose own name and place may differ.
  const pristine = new Map<number, boolean>();
  const isPristine = (node: number): boolean => {
    let result = pristine.get(node);
    if (result === undefined) {
      if (structure.nodes[node]!.prototype >= 0) {
        result = true;
      } else {
        const original = originalChildren(node);
        const children = structure.childrenOf(node);
        result =
          !!original &&
          original.named &&
          original.nodes.length === children.length &&
          children.every(
            (child, i) =>
              child === original.nodes[i] &&
              included[child] === 1 &&
              !renamed.has(child) &&
              samePlacement(source.local(child), original.matrices[i]!) &&
              isPristine(child),
          );
      }
      pristine.set(node, result);
    }
    return result;
  };

  const plan: PlanNode[] = [];
  const emit = (node: number, parent: number, placement: readonly number[]): void => {
    const isPart = structure.nodes[node]!.prototype >= 0;
    const { ref, piece } = originOf(node);
    const top = parent < 0;
    const reuse = (isPart || isPristine(node)) && ref >= 0 && (isPart || !top || samePlacement(placement, Identity));
    const index = plan.length;
    plan.push({
      kind: reuse ? PlanKind.Reuse : PlanKind.Assembly,
      parent,
      ref,
      piece,
      matrix: top && !isPart ? Identity : placement,
      name: structure.nodes[node]!.name,
    });
    if (!reuse) {
      // A top-level assembly's placement goes into its children (see above).
      const fold = top ? placement : Identity;
      for (const child of structure.childrenOf(node)) {
        if (included[child] === 1) {
          emit(child, index, top ? multiply(fold, source.local(child)) : source.local(child));
        }
      }
    }
  };
  return { plan, emit, included: (node: number) => included[node] === 1 };
}
