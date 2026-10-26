import type { ExpandedPiece } from '@j3d/occt/facade';
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
  /** Added nodes that Expand made (M15); absent from edits kept before M15. */
  pieces?: ExpandedNode[];
}

/**
 * An added node that Expand made (M15, D154, D189): the assembly that takes a compound part's place
 * (piece -1), or one of the part's pieces. Its added source is -1, as a new assembly's.
 */
export interface ExpandedNode {
  node: number;
  /** The part it expands: a file node, or a copy of one. It leaves the tree as the assembly takes its place. */
  expands: number;
  /** Its piece in the part's expansion, or -1 for the assembly. */
  piece: number;
  /** Its name before any rename: the file's, or numbered after its parent (D191). */
  name: string;
  /** It draws something: .NET's tree tells parts by this; the viewer checks it against the expansion. */
  part: boolean;
}

/** Each expanded file part's pieces, as the facade gives them (M15): their prototypes are the model's. */
export type Expansions = ReadonlyMap<number, readonly ExpandedPiece[]>;

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
  return !!edits && (edits.added.length > 0 || edits.children.length > 0 || edits.names.length > 0 || (edits.pieces?.length ?? 0) > 0);
}

/** The file parts whose expansions these edits need (M15), in the order they're first expanded. */
export function expandedFileNodes(fileCount: number, edits: ModelEdits | undefined): number[] {
  // Each added node's file node, followed back through its sources.
  const fileNodes = new Map<number, number>();
  edits?.added.forEach((source, offset) => fileNodes.set(fileCount + offset, source < fileCount ? source : (fileNodes.get(source) ?? -1)));
  const needed: number[] = [];
  for (const { expands } of edits?.pieces ?? []) {
    const file = expands < fileCount ? expands : (fileNodes.get(expands) ?? -1);
    if (file >= 0 && !needed.includes(file)) {
      needed.push(file);
    }
  }
  return needed;
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
  /** The file's node ids each added part draws: its source, followed back to the file; -1 for Expand's nodes and their copies. */
  readonly fileNodes: number[];
  /** Each node's name before any rename. */
  private readonly defaultNames: string[];
  /** Expand's nodes (M15). */
  private readonly expanded = new Map<number, ExpandedNode>();
  /** Each piece's piece parent (the assembly, or a piece above it) and its placement in that parent's frame. */
  private readonly pieceFrames = new Map<number, { parent: number; matrix: readonly number[] }>();
  private readonly childLists = new Map<number, number[]>();
  private readonly liveFlags: Uint8Array;
  private orderCache: number[] | undefined;

  constructor(
    readonly fileTree: readonly TreeNode[],
    readonly edits: ModelEdits = NoEdits,
    expansions: Expansions = new Map(),
  ) {
    const fileCount = fileTree.length;
    const total = fileCount + edits.added.length;
    for (const piece of edits.pieces ?? []) {
      if (!Number.isInteger(piece.node) || piece.node < fileCount || piece.node >= total || edits.added[piece.node - fileCount] !== -1 || this.expanded.has(piece.node)) {
        throw new EditsMismatchError(`Node ${piece.node} is given as Expand's, but it isn't a new node.`);
      }
      if (!Number.isInteger(piece.expands) || piece.expands < 0 || piece.expands >= piece.node) {
        throw new EditsMismatchError(`Node ${piece.node} expands node ${piece.expands}, which comes after it or doesn't exist.`);
      }
      this.expanded.set(piece.node, piece);
    }
    const names = new Map<number, string>();
    for (const { node, name } of edits.names) {
      if (!Number.isInteger(node) || node < 0 || node >= total) {
        throw new EditsMismatchError(`A name is given to node ${node}, which the model doesn't have.`);
      }
      names.set(node, name);
    }

    this.nodes = fileTree.map((node, index) => ({ name: names.get(index) ?? node.name, parent: node.parent, prototype: node.prototype }));
    this.defaultNames = fileTree.map((node) => node.name);
    this.sources = fileTree.map(() => -1);
    this.fileNodes = fileTree.map((_, index) => index);
    const pieceNodes = new Map<string, number>();
    edits.added.forEach((source, offset) => {
      const id = fileCount + offset;
      if (!Number.isInteger(source) || source < -1 || source >= id) {
        throw new EditsMismatchError(`Added node ${id} copies node ${source}, which comes after it or doesn't exist.`);
      }
      const copied = source >= 0 ? this.nodes[source]! : undefined;
      const fileNode = source >= 0 ? this.fileNodes[source]! : -1;
      const expanded = this.expanded.get(id);
      // A copy's name before any rename is its source's: the file's, a piece's or a new assembly's.
      const defaultName = expanded ? expanded.name : fileNode >= 0 ? fileTree[fileNode]!.name : copied ? this.defaultNames[source]! : 'Assembly';
      let prototype = copied?.prototype ?? -1;
      if (expanded) {
        prototype = this.expandedPrototype(expanded, expansions, pieceNodes);
        pieceNodes.set(`${expanded.expands}:${expanded.piece}`, id);
      }
      this.nodes.push({ name: names.get(id) ?? defaultName, parent: TopLevel, prototype });
      this.defaultNames.push(defaultName);
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

  /** Expand's node, if this is one (M15). */
  expansionOf(node: number): ExpandedNode | undefined {
    return this.expanded.get(node);
  }

  /** Where Expand puts a piece: its piece parent (the assembly, or a piece) and its placement in that parent's frame. */
  pieceFrame(node: number): { parent: number; matrix: readonly number[] } | undefined {
    return this.pieceFrames.get(node);
  }

  /** What an added node is, to tell whether an id still holds the same one after an undo: a copy of a node, Expand's, or a new assembly. */
  addedKey(node: number): string {
    const expanded = this.expanded.get(node);
    return expanded ? `p${expanded.expands}:${expanded.piece}` : `c${this.sources[node] ?? -1}`;
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

  /** Checks an Expand node against its part's expansion, noting a piece's frame; returns the prototype it draws. */
  private expandedPrototype(expanded: ExpandedNode, expansions: Expansions, pieceNodes: ReadonlyMap<string, number>): number {
    const part = this.nodes[expanded.expands];
    const fileNode = this.fileNodes[expanded.expands] ?? -1;
    const pieces = fileNode >= 0 ? expansions.get(fileNode) : undefined;
    if (!part || part.prototype < 0 || !pieces) {
      throw new EditsMismatchError(`Node ${expanded.node} expands node ${expanded.expands}, which isn't an expanded part.`);
    }
    if (expanded.piece === -1) {
      return -1;
    }
    const piece = Number.isInteger(expanded.piece) ? pieces[expanded.piece] : undefined;
    const parent = piece ? pieceNodes.get(`${expanded.expands}:${piece.parent}`) : undefined;
    if (!piece || parent === undefined || piece.prototype >= 0 !== expanded.part) {
      throw new EditsMismatchError(`Node ${expanded.node} is piece ${expanded.piece} of node ${expanded.expands}, which its expansion doesn't have.`);
    }
    this.pieceFrames.set(expanded.node, { parent, matrix: piece.matrix });
    return piece.prototype;
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
  const text = (edits: ModelEdits | undefined) => {
    const { added, children, names, pieces } = edits ?? NoEdits;
    return JSON.stringify({ added, children, names, pieces: pieces ?? [] });
  };
  return text(a) === text(b);
}
