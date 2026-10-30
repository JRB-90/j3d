# @j3d/occt

The [Open CASCADE Technology](https://dev.opencascade.org/) kernel compiled to WebAssembly, behind a worker per model. It opens STEP, IGES and BREP files in the browser and gives their tree and meshes, and it measures, expands and exports them. There's no three.js in it.

`@j3d/viewer` installs this for you. Use it directly only if you want the kernel without that viewer.

## Install

It's a file on a [GitHub Release](https://github.com/JRB-90/j3d/releases), not on the npm registry:

```bash
npm install https://github.com/JRB-90/j3d/releases/download/v0.1.0/j3d-occt-0.1.0.tgz
```

Vite and webpack need no configuration: your bundler copies the worker and the WebAssembly itself.

## Use

```ts
import { openModel } from '@j3d/occt';

const model = await openModel(file, 'step');

for (const node of model.scene.nodes) {
  console.log(node.name);
}
console.log(`${model.stats.triangles} triangles, ${model.memoryBytes} bytes of WebAssembly heap`);

model.dispose();
```

Each model has a worker of its own, which keeps its BREP until `dispose()`. `scene` holds the tree (`nodes`), each mesh once (`prototypes`, in plain typed arrays) and every placement of one (`instances`).

The model's `measure`, `exporter`, `expander` and `arriver` work on it in that worker. `onProgress` reports the import's phases and `signal` stops it.

For a worker of your own, `@j3d/occt/facade` is the typed wrapper around the module, and `@j3d/occt/core` holds the errors, progress and types with no worker in them.

[`docs/library.md`](https://github.com/JRB-90/j3d/blob/main/docs/library.md) covers all three J3D packages. How the WebAssembly is built is in [`BUILDING.md`](https://github.com/JRB-90/j3d/blob/main/src/J3D.Occt/BUILDING.md).

## Licence

LGPL 2.1 with the Open CASCADE exception: see `LICENSE`. The WebAssembly is a separate file, and everything needed to rebuild it, or build it from a modified OCCT, is in [`src/J3D.Occt`](https://github.com/JRB-90/j3d/tree/main/src/J3D.Occt). `THIRD-PARTY-NOTICES.md` lists what's compiled into it.
