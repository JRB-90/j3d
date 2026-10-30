# @j3d/viewer

A three.js viewer for CAD and mesh models, for any web app. It opens STEP, IGES and BREP files with the OCCT kernel compiled to WebAssembly, and STL, OBJ and glTF meshes, each in a worker, and it picks, measures, moves and exports them. Everything runs in the browser.

## Install

It's a file on a [GitHub Release](https://github.com/JRB-90/j3d/releases), not on the npm registry. Installing its URL brings `@j3d/occt` from the same release, and `three` is a peer dependency, so your app and the viewer share one copy:

```bash
npm install https://github.com/JRB-90/j3d/releases/download/v0.1.0/j3d-viewer-0.1.0.tgz three@0.186.1
```

Vite and webpack need no configuration: the packages ship ES modules, and your bundler copies the workers and the WebAssembly itself.

## Use

```ts
import { createViewer } from '@j3d/viewer';

const viewer = createViewer(document.querySelector<HTMLElement>('#viewer')!);
viewer.attachFileInput(document.querySelector<HTMLInputElement>('#files')!);
```

The viewer fills its element, so give that a size. Files can also be dropped on the view, or passed to `viewer.importFiles(files)`.

**It leaves the state to you.** A click comes to `onPick`, and `setPartState` says what to draw selected and hidden, so selection, visibility, undo and the edited tree work however your app wants them. Keys and keeping models across visits are off unless `createViewer` asks for them.

[`docs/library.md`](https://github.com/JRB-90/j3d/blob/main/docs/library.md) takes a new project from nothing to a loaded model, and [`samples/vite`](https://github.com/JRB-90/j3d/tree/main/samples/vite) is a working app. `CreateViewerOptions` and `ViewerHandle` are the reference, with a comment on every member.

## Licence

MIT. See `LICENSE` and `THIRD-PARTY-NOTICES.md`. The kernel it installs is LGPL 2.1 with the Open CASCADE exception, a separate package.
