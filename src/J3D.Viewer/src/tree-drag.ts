/**
 * Dragging nodes in the model list's trees (M14, D182): MudBlazor's tree view has no drag and drop,
 * so the browser's drag events are handled here, for every tree, from the document. A node row is
 * `[data-tree-node="<model>:<node>"]`, draggable while edits are on offer; an assembly row is marked
 * `data-tree-assembly`, and a model's name `[data-model-drop="<model>"]`. A drop is offered on an
 * assembly or a model's name, outside the dragged node's own subtree (since M16 the rows are flat, D198,
 * so each lists its ancestors in `data-tree-ancestors`), and since M18 in another model too (D210); .NET
 * decides the rest, as a drop moves the whole selection when the dragged node is selected, and refuses
 * one between a CAD model and a mesh model, saying why. Ctrl copies instead of moving (D183).
 */
export interface TreeDrop {
  /** The dragged node, `<model>:<node>`. */
  source: string;
  /** The model dropped on. */
  model: string;
  /** The assembly dropped on, or -1 for the model's top level. */
  target: number;
  copy: boolean;
}

/** The drag's data type: a J3D tree node, which nothing else accepts. */
export const TreeNodeType = 'application/x-j3d-tree-node';

const DropTargetClass = 'j3d-drop-target';

export function installTreeDrag(root: Document | HTMLElement, dropped: (drop: TreeDrop) => void): () => void {
  let dragged: { key: string; model: string; node: number } | undefined;
  let highlighted: HTMLElement | undefined;

  const highlight = (element: HTMLElement | undefined) => {
    if (element !== highlighted) {
      highlighted?.classList.remove(DropTargetClass);
      element?.classList.add(DropTargetClass);
      highlighted = element;
    }
  };

  /** Where the pointer is, if a drop there is offered: an assembly row, or a model's name. */
  const targetOf = (event: DragEvent): { element: HTMLElement; model: string; target: number } | undefined => {
    if (!dragged || !(event.target instanceof Element)) {
      return undefined;
    }
    const header = event.target.closest<HTMLElement>('[data-model-drop]');
    const headerModel = header?.dataset['modelDrop'];
    if (header && headerModel) {
      return { element: header, model: headerModel, target: -1 };
    }
    const row = event.target.closest<HTMLElement>('[data-tree-node]');
    const key = row?.dataset['treeNode'];
    if (!row || !key || row.dataset['treeAssembly'] !== 'true') {
      return undefined;
    }
    const [model, node] = splitKey(key);
    const ancestors = (row.dataset['treeAncestors'] ?? '').split(' ').filter(Boolean).map(Number);
    const inside = model === dragged.model && (node === dragged.node || ancestors.includes(dragged.node));
    return !inside ? { element: row, model, target: node } : undefined;
  };

  const onDragStart = (event: DragEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tree-node][draggable="true"]') : null;
    const key = row?.dataset['treeNode'];
    if (!row || !key || !event.dataTransfer) {
      return;
    }
    event.stopPropagation();
    const [model, node] = splitKey(key);
    dragged = { key, model, node };
    // Firefox starts a drag only with data set.
    event.dataTransfer.setData(TreeNodeType, key);
    event.dataTransfer.effectAllowed = 'copyMove';
  };
  const onDragOver = (event: DragEvent) => {
    const found = targetOf(event);
    highlight(found?.element);
    if (found && event.dataTransfer) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? 'copy' : 'move';
    }
  };
  const onDrop = (event: DragEvent) => {
    const found = targetOf(event);
    const source = dragged;
    highlight(undefined);
    dragged = undefined;
    if (found && source) {
      event.preventDefault();
      dropped({ source: source.key, model: found.model, target: found.target, copy: event.ctrlKey || event.metaKey });
    }
  };
  const onDragEnd = () => {
    highlight(undefined);
    dragged = undefined;
  };
  const onDragLeave = (event: DragEvent) => {
    if (highlighted && event.target === highlighted && !highlighted.contains(event.relatedTarget as Node | null)) {
      highlight(undefined);
    }
  };

  const listeners: [string, (event: DragEvent) => void][] = [
    ['dragstart', onDragStart],
    ['dragover', onDragOver],
    ['drop', onDrop],
    ['dragend', onDragEnd],
    ['dragleave', onDragLeave],
  ];
  for (const [type, listener] of listeners) {
    root.addEventListener(type, listener as EventListener);
  }
  return () => {
    for (const [type, listener] of listeners) {
      root.removeEventListener(type, listener as EventListener);
    }
    highlight(undefined);
  };
}

/** `<model>:<node>`, split at its last colon (model ids are UUIDs, which have none). */
function splitKey(key: string): [string, number] {
  const colon = key.lastIndexOf(':');
  return [key.slice(0, colon), Number(key.slice(colon + 1))];
}
