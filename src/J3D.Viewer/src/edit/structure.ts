import type { ExpandedPiece, SceneNode } from '@j3d/occt/facade';
import type { Object3D } from 'three';
import type { TreeNode } from '../import/types.js';

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
  /** Objects moved or copied in from other models (M18), in the order they came; absent before M18. */
  arrivals?: KeptArrival[];
  /** Added nodes that arrived (M18). */
  arrived?: ArrivedNode[];
}

/**
 * Objects moved or copied in from another model (M18, D225, D227, D230): a file of the model's own,
 * which the facade (or, for a mesh model, the viewer) reads in. Its nodes, its own assembly first, are
 * numbered after the file's and every earlier arrival's ({@link arrivalBase}).
 */
export interface KeptArrival {
  /** Its file in the model's folder. */
  file: string;
  /** How many nodes it has, its own assembly included. */
  nodes: number;
}

/**
 * An added node that arrived (M18): node `index` of arrival `arrival` (an index into
 * {@link ModelEdits.arrivals}), never 0, the arrival's own assembly, which isn't in the tree. Its added
 * source is -1, as a new assembly's.
 */
export interface ArrivedNode {
  node: number;
  arrival: number;
  index: number;
  /** Its name when it arrived. */
  name: string;
  /** It draws something. */
  part: boolean;
  /** A compound part Expand would split (D190). */
  expandable?: boolean;
}

/** An arrival as read in (M18): its nodes (each parent an earlier one, or -1) and, for a mesh model, their objects. */
export interface ArrivalContent {
  nodes: readonly SceneNode[];
  objects?: readonly Object3D[];
}

/** The arrivals a model has read in, by file. */
export type Arrivals = ReadonlyMap<string, ArrivalContent>;

/** Where arrival `index` of the list starts: after the file's nodes and each earlier arrival's (M18). */
export function arrivalBase(fileCount: number, arrivals: readonly KeptArrival[] | undefined, index: number): number {
  let base = fileCount;
  for (let i = 0; i < index; i++) {
    base += arrivals![i]!.nodes;
  }
  return base;
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

const Identity: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Kept edits that don't fit the model's tree (R25): it loads as imported. */
export class EditsMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditsMismatchError';
  }
}

export function hasEdits(edits: ModelEdits | undefined): edits is ModelEdits {
  return (
    !!edits &&
    (edits.added.length > 0 || edits.children.length > 0 || edits.names.length > 0 || (edits.pieces?.length ?? 0) > 0 || (edits.arrived?.length ?? 0) > 0)
  );
}

/**
 * The node each node stands for in the facade's numbering (M18): a file node is itself, an arrived node
 * is its arrival's base plus its index, and a copy is its source's; -1 for anything else.
 */
function sourceNodesOf(fileCount: number, edits: ModelEdits | undefined): number[] {
  const arrived = new Map((edits?.arrived ?? []).map((node) => [node.node, node]));
  const sources = Array.from({ length: fileCount }, (_, index) => index);
  edits?.added.forEach((source, offset) => {
    const node = arrived.get(fileCount + offset);
    sources.push(node ? arrivalBase(fileCount, edits.arrivals, node.arrival) + node.index : source >= 0 && source < sources.length ? sources[source]! : -1);
  });
  return sources;
}

/**
 * The parts whose expansions these edits need (M15), in the order they're first expanded, each as the
 * facade numbers it: a file part, or since M18 an arrived one.
 */
export function expandedFileNodes(fileCount: number, edits: ModelEdits | undefined): number[] {
  const sources = sourceNodesOf(fileCount, edits);
  const needed: number[] = [];
  for (const { expands } of edits?.pieces ?? []) {
    const file = sources[expands] ?? -1;
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
  /** The file's node ids each added part draws: its source, followed back to the file; -1 for Expand's nodes, arrived nodes and their copies. */
  readonly fileNodes: number[];
  /** The node each node stands for in the facade's numbering: the file's, or an arrived one's (M18); -1 for the rest. */
  readonly sourceNodes: number[];
  /** Each node's name before any rename. */
  private readonly defaultNames: string[];
  /** Expand's nodes (M15). */
  private readonly expanded = new Map<number, ExpandedNode>();
  /** Arrived nodes (M18), and each one's arrival parent (or the model's top level) and placement in its frame. */
  private readonly arrived = new Map<number, ArrivedNode>();
  private readonly arrivalFrames = new Map<number, { parent: number; matrix: readonly number[]; object: Object3D | undefined }>();
  /** Each piece's piece parent (the assembly, or a piece above it) and its placement in that parent's frame. */
  private readonly pieceFrames = new Map<number, { parent: number; matrix: readonly number[] }>();
  private readonly childLists = new Map<number, number[]>();
  private readonly liveFlags: Uint8Array;
  private orderCache: number[] | undefined;

  constructor(
    readonly fileTree: readonly TreeNode[],
    readonly edits: ModelEdits = NoEdits,
    expansions: Expansions = new Map(),
    arrivals: Arrivals = new Map(),
  ) {
    const fileCount = fileTree.length;
    const total = fileCount + edits.added.length;
    for (const node of edits.arrived ?? []) {
      const kept = Number.isInteger(node.arrival) ? edits.arrivals?.[node.arrival] : undefined;
      if (!Number.isInteger(node.node) || node.node < fileCount || node.node >= total || edits.added[node.node - fileCount] !== -1 || this.arrived.has(node.node)) {
        throw new EditsMismatchError(`Node ${node.node} is given as arrived, but it isn't a new node.`);
      }
      if (!kept || !Number.isInteger(node.index) || node.index < 1 || node.index >= kept.nodes) {
        throw new EditsMismatchError(`Node ${node.node} is node ${node.index} of arrival ${node.arrival}, which doesn't have it.`);
      }
      this.arrived.set(node.node, node);
    }
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
    this.sourceNodes = sourceNodesOf(fileCount, edits);
    const pieceNodes = new Map<string, number>();
    const arrivedNodes = new Map<string, number>();
    edits.added.forEach((source, offset) => {
      const id = fileCount + offset;
      if (!Number.isInteger(source) || source < -1 || source >= id) {
        throw new EditsMismatchError(`Added node ${id} copies node ${source}, which comes after it or doesn't exist.`);
      }
      const copied = source >= 0 ? this.nodes[source]! : undefined;
      const fileNode = source >= 0 ? this.fileNodes[source]! : -1;
      const expanded = this.expanded.get(id);
      const arrived = this.arrived.get(id);
      // A copy's name before any rename is its source's: the file's, a piece's, an arrived node's or a new assembly's.
      const defaultName = expanded
        ? expanded.name
        : arrived
          ? arrived.name
          : fileNode >= 0
            ? fileTree[fileNode]!.name
            : copied
              ? this.defaultNames[source]!
              : 'Assembly';
      let prototype = copied?.prototype ?? -1;
      if (expanded) {
        prototype = this.expandedPrototype(expanded, expansions, pieceNodes);
        pieceNodes.set(`${expanded.expands}:${expanded.piece}`, id);
      } else if (arrived) {
        prototype = this.arrivedPrototype(arrived, arrivals, arrivedNodes);
        arrivedNodes.set(`${arrived.arrival}:${arrived.index}`, id);
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

  /** An arrived node, if this is one (M18). */
  arrivalOf(node: number): ArrivedNode | undefined {
    return this.arrived.get(node);
  }

  /**
   * Where an arrived node was put (M18): its arrival parent, or {@link TopLevel} for the objects that
   * arrived (placed in the model's own frame, D228), and its placement in that parent's frame; for a
   * mesh model, the object it's a copy of.
   */
  arrivalFrame(node: number): { parent: number; matrix: readonly number[]; object: Object3D | undefined } | undefined {
    return this.arrivalFrames.get(node);
  }

  /** What an added node is, to tell whether an id still holds the same one after an undo: a copy of a node, Expand's, an arrived one or a new assembly. */
  addedKey(node: number): string {
    const expanded = this.expanded.get(node);
    const arrived = this.arrived.get(node);
    return expanded
      ? `p${expanded.expands}:${expanded.piece}`
      : arrived
        ? `a${this.edits.arrivals?.[arrived.arrival]?.file ?? ''}:${arrived.index}`
        : `c${this.sources[node] ?? -1}`;
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

  /** Checks an arrived node against its arrival, noting its frame; returns the prototype it draws. */
  private arrivedPrototype(arrived: ArrivedNode, arrivals: Arrivals, arrivedNodes: ReadonlyMap<string, number>): number {
    const content = arrivals.get(this.edits.arrivals![arrived.arrival]!.file);
    const node = content?.nodes[arrived.index];
    if (!node) {
      throw new EditsMismatchError(`Node ${arrived.node} arrived in a file that hasn't been read.`);
    }
    if (node.prototype >= 0 !== arrived.part) {
      throw new EditsMismatchError(`Node ${arrived.node} doesn't match node ${arrived.index} of its arrival.`);
    }
    const parent = node.parent <= 0 ? TopLevel : arrivedNodes.get(`${arrived.arrival}:${node.parent}`);
    if (parent === undefined) {
      throw new EditsMismatchError(`Node ${arrived.node} arrived without its parent.`);
    }
    this.arrivalFrames.set(arrived.node, { parent, matrix: node.matrix ?? Identity, object: content.objects?.[arrived.index] });
    return node.prototype;
  }

  /** Checks an Expand node against its part's expansion, noting a piece's frame; returns the prototype it draws. */
  private expandedPrototype(expanded: ExpandedNode, expansions: Expansions, pieceNodes: ReadonlyMap<string, number>): number {
    const part = this.nodes[expanded.expands];
    const fileNode = this.sourceNodes[expanded.expands] ?? -1;
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
    const { added, children, names, pieces, arrivals, arrived } = edits ?? NoEdits;
    return JSON.stringify({ added, children, names, pieces: pieces ?? [], arrivals: arrivals ?? [], arrived: arrived ?? [] });
  };
  return text(a) === text(b);
}
