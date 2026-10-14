/** Shown on the viewport's host while files are dragged over it. */
export const DropClass = 'j3d-viewport--drop';

/**
 * Turns the viewport into a drop target for files (docs/plan.md §6.3): an overlay appears while files
 * are dragged over it, and a drop hands the `DataTransfer` to `importDrop` synchronously, as
 * `filesFromDataTransfer` requires. Drags of anything other than files are ignored.
 */
export function installDropTarget(host: HTMLElement, importDrop: (dataTransfer: DataTransfer) => void): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'j3d-drop-overlay';
  overlay.dataset['testid'] = 'drop-overlay';
  const label = document.createElement('div');
  label.className = 'j3d-drop-overlay__label';
  label.textContent = 'Drop files to import';
  overlay.append(label);
  host.append(overlay);

  // dragenter and dragleave fire for every child element crossed, so count them.
  let depth = 0;
  const show = (visible: boolean) => host.classList.toggle(DropClass, visible);
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;

  const onDragEnter = (event: DragEvent) => {
    if (hasFiles(event)) {
      event.preventDefault();
      depth++;
      show(true);
    }
  };
  const onDragOver = (event: DragEvent) => {
    if (hasFiles(event)) {
      event.preventDefault(); // allows the drop
      event.dataTransfer!.dropEffect = 'copy';
    }
  };
  const onDragLeave = (event: DragEvent) => {
    if (hasFiles(event) && --depth <= 0) {
      depth = 0;
      show(false);
    }
  };
  const onDrop = (event: DragEvent) => {
    if (hasFiles(event)) {
      event.preventDefault(); // stops the browser opening the file
      depth = 0;
      show(false);
      importDrop(event.dataTransfer!);
    }
  };

  host.addEventListener('dragenter', onDragEnter);
  host.addEventListener('dragover', onDragOver);
  host.addEventListener('dragleave', onDragLeave);
  host.addEventListener('drop', onDrop);
  return () => {
    host.removeEventListener('dragenter', onDragEnter);
    host.removeEventListener('dragover', onDragOver);
    host.removeEventListener('dragleave', onDragLeave);
    host.removeEventListener('drop', onDrop);
    show(false);
    overlay.remove();
  };
}
