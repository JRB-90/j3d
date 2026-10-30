import { createViewer, type LoadedModel, type PartRef } from '@j3d/viewer';

const status = document.querySelector<HTMLElement>('#status')!;
const models = new Map<string, LoadedModel>();
let selected: PartRef | undefined;

// The viewer draws and reports; what's selected is yours to keep, and to hand back to it.
const viewer = createViewer(document.querySelector<HTMLElement>('#viewer')!, {
  onPick(part) {
    if (selected) {
      viewer.setPartState(selected.id, [], []);
    }
    selected = part;
    if (part) {
      viewer.setPartState(part.id, [], [part.node]);
    }
    status.textContent = part ? models.get(part.id)!.tree[part.node]!.name : 'Click a part to select it.';
  },
});

viewer.attachFileInput(document.querySelector<HTMLInputElement>('#files')!);

viewer.subscribe({
  queued(summary) {
    status.textContent = `Opening ${summary.fileName}…`;
  },
  loaded(model) {
    models.set(model.summary.id, model);
    status.textContent = 'Click a part to select it.';
  },
  failed(_id, error) {
    status.textContent = error.message;
  },
  rejected(fileName, reason) {
    status.textContent = `${fileName}: ${reason}`;
  },
});
