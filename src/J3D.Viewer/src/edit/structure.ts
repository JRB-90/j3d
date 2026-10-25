import type { TreeNode } from '../import/types';

/**
 * A model's edits to its tree (M14, D151–D152, D180–D187), as .NET makes them and the store keeps them
 * (mirrors J3D.Web.Client/State/ModelEdits.cs). Node ids from the file's node count up are added nodes,
 * in the order they were added. A child list that changed replaces the file's; a node in no list is
 * removed, with everything under it. Placements aren't here: they're kept as moves are (M13).
 */
export interface ModelEdits {
  /** Each added node's source: the node it copies (an earlier one), or -1 for a new assembly. */
  added: number[];
  /** Child lists that differ from the file's; parent -1 is the model's top level. */
  children: { parent: number; nodes: number[] }[];
  /** Names given by Rename and New assembly, and copies of renamed nodes. */
  names: { node: number; name: string }[];
}

export const NoEdits: ModelEdits = { added: [], children: [], names: [] };

/** The model's top level, as a parent. */
export const TopLevel = -1;

/** Kept edits that don't fit the model's tree (R25): it loads as imported. */
export class EditsMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditsMismatchError';
  }
}

export function hasEdits(edits: ModelEdits | undefined): edits is ModelEdits {
  return !!edits && (edits.added.length > 0 || edits.children.length > 0 || edits.names.length > 0);
}

/**
 * A model's tree with its edits applied: every node, the file's and the added ones, by id, with its
 * name, prototype, parent and children. Only nodes reachable from the top level are live; a removed
 * node keeps the parent it had in the file, or in its own removed subtree.
 */
export class ModelStructure {
  /** Each node as it now is; a removed node's `parent` is where it was last known to be. */
  readonly nodes: TreeNode[];
  /** Each added node's source (see {@link ModelEdits.added}); -1 for the file's nodes. */
  readonly sources: number[];
  /** The file's node ids each added part draws: its source, followed back to the file. */
  readonly fileNodes: number[];
  private readonly childLists = new Map<number, number[]>();
  private readonly liveFlags: Uint8Array;
  private orderCache: number[] | undefined;

  constructor(
    readonly fileTree: readonly TreeNode[],
    readonly edits: ModelEdits = NoEdits,
  ) {
    const fileCount = fileTree.length;
    const total = fileCount + edits.added.length;
    const names = new Map<number, string>();
    for (const { node, name } of edits.names) {
      if (!Number.isInteger(node) || node < 0 || node >= total) {
        throw new EditsMismatchError(`A name is given to node ${node}, which the model doesn't have.`);
      }
      names.set(node, name);
    }

    this.nodes = fileTree.map((node, index) => ({ name: names.get(index) ?? node.name, parent: node.parent, prototype: node.prototype }));
    this.sources = fileTree.map(() => -1);
    this.fileNodes = fileTree.map((_, index) => index);
    edits.added.forEach((source, offset) => {
      const id = fileCount + offset;
      if (!Number.isInteger(source) || source < -1 || source >= id) {
        throw new EditsMismatchError(`Added node ${id} copies node ${source}, which comes after it or doesn't exist.`);
      }
      const copied = source >= 0 ? this.nodes[source]! : undefined;
      const fileNode = source >= 0 ? this.fileNodes[source]! : -1;
      this.nodes.push({ name: names.get(id) ?? (fileNode >= 0 ? fileTree[fileNode]!.name : 'Assembly'), parent: TopLevel, prototype: copied?.prototype ?? -1 });
      this.sources.push(source);
      this.fileNodes.push(fileNode);
    });

    // The file's child lists (a parent always comes before its children), then the edited ones.
    fileTree.forEach((node, index) => {
      const parent = node.parent >= 0 && node.parent < index ? node.parent : TopLevel;
      this.listOf(parent).push(index);
    });
    for (const { parent, nodes } of edits.children) {
      if (!Number.isInteger(parent) || parent < TopLevel || parent >= total) {
        throw new EditsMismatchError(`A child list is given for node ${parent}, which the model doesn't have.`);
      }
      if (nodes.some((node) => !Number.isInteger(node) || node < 0 || node >= total)) {
        throw new EditsMismatchError(`Node ${parent}'s children include a node the model doesn't have.`);
      }
      this.childLists.set(parent, [...nodes]);
    }

    const seen = new Uint8Array(total);
    for (const [parent, nodes] of this.childLists) {
      for (const node of nodes) {
        if (seen[node]) {
          throw new EditsMismatchError(`Node ${node} is in two places.`);
        }
        seen[node] = 1;
        this.nodes[node]!.parent = parent;
      }
    }

    this.liveFlags = new Uint8Array(total);
    const pending = [...this.childrenOf(TopLevel)];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (this.liveFlags[node]) {
        throw new EditsMismatchError(`Node ${node} is inside itself.`);
      }
      this.liveFlags[node] = 1;
      pending.push(...this.childrenOf(node));
    }
    // A cycle away from the top level is never reached, so it's harmless but still wrong.
    for (let node = 0; node < total; node++) {
      for (let current = this.nodes[node]!.parent, steps = 0; current >= 0; current = this.nodes[current]!.parent) {
        if (++steps > total) {
          throw new EditsMismatchError(`Node ${node} is inside itself.`);
        }
      }
    }
  }

  get count(): number {
    return this.nodes.length;
  }

  /** In the model: reachable from its top level. */
  isLive(node: number): boolean {
    return this.liveFlags[node] === 1;
  }

  isPart(node: number): boolean {
    return this.isLive(node) && this.nodes[node]!.prototype >= 0;
  }

  /** A node's children in order ({@link TopLevel}: the top-level nodes). */
  childrenOf(node: number): readonly number[] {
    return this.childLists.get(node) ?? [];
  }

  /** The live nodes, each before its children, siblings in order. */
  order(): readonly number[] {
    if (!this.orderCache) {
      const order: number[] = [];
      const visit = (node: number) => {
        order.push(node);
        this.childrenOf(node).forEach(visit);
      };
      this.childrenOf(TopLevel).forEach(visit);
      this.orderCache = order;
    }
    return this.orderCache;
  }

  /** The live part nodes, in tree order. */
  parts(): number[] {
    return this.order().filter((node) => this.nodes[node]!.prototype >= 0);
  }

  /** The node and everything under it, each before its children, whether live or not. */
  subtree(node: number): number[] {
    const nodes: number[] = [];
    const visit = (current: number) => {
      nodes.push(current);
      this.childrenOf(current).forEach(visit);
    };
    visit(node);
    return nodes;
  }

  private listOf(parent: number): number[] {
    let list = this.childLists.get(parent);
    if (!list) {
      list = [];
      this.childLists.set(parent, list);
    }
    return list;
  }
}

/** The same edits, compared by value: .NET sends them whole, often unchanged. */
export function sameEdits(a: ModelEdits | undefined, b: ModelEdits | undefined): boolean {
  return JSON.stringify(a ?? NoEdits) === JSON.stringify(b ?? NoEdits);
}
