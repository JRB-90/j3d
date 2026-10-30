# Using J3D in your own project

J3D's viewer comes as three packages. Pick the one that fits your app and go from nothing to a loaded model below.

| Package | For | What it is |
|---|---|---|
| `@j3d/viewer` | Any web app | The three.js viewer: import, view, pick, measure, move, export and keep. Your page owns selection, undo and the tree. |
| `J3D.Blazor` | Blazor WebAssembly | A `<J3DViewer>` component, with the scene's selection, undo and tree edits already written. |
| `@j3d/occt` | Code that only needs the kernel | OCCT in a worker: open STEP, IGES and BREP files and read their tree and meshes, with no three.js. `@j3d/viewer` brings this for you. |

The packages are files on this repository's [GitHub Releases](https://github.com/JRB-90/j3d/releases), not on the npm or NuGet registries. Everything runs in the browser: a model never leaves the machine it's opened on.

Each package's own README covers its details. [`samples/`](../samples) holds a working app of each kind, and the types' own comments are the reference for everything else.

## A web app, with `@j3d/viewer`

This uses Vite, but webpack works the same way. Neither needs any configuration for J3D.

```bash
npm create vite@latest my-viewer -- --template vanilla-ts
```

```bash
cd my-viewer
```

Install the viewer from the release. Its dependency on `@j3d/occt` is that release's URL too, so one install brings both. `three` is a peer dependency, so your app and the viewer share one copy.

```bash
npm install https://github.com/JRB-90/j3d/releases/download/v0.1.0/j3d-viewer-0.1.0.tgz three@0.186.1
```

Put an input and an element for the viewer in `index.html`, in place of the template's `#app`:

```html
<input id="files" type="file" multiple />
<div id="viewer" style="height: 80vh"></div>
<script type="module" src="/src/main.ts"></script>
```

The viewer fills its element, so that element needs a size. Then replace `src/main.ts`:

```ts
import { createViewer } from '@j3d/viewer';

const viewer = createViewer(document.querySelector<HTMLElement>('#viewer')!);
viewer.attachFileInput(document.querySelector<HTMLInputElement>('#files')!);
```

```bash
npm run dev
```

Pick a file, or drop one on the view. The mouse turns, pans and zooms, and the view has its cube, Home, and Previous and Next view buttons.

### Selecting

The viewer draws and reports. What's selected, what's hidden and what can be undone are yours to keep, so you decide how they work. A click comes to `onPick`, and you hand back what you want drawn:

```ts
import { createViewer, type LoadedModel, type PartRef } from '@j3d/viewer';

const models = new Map<string, LoadedModel>();
let selected: PartRef | undefined;

const viewer = createViewer(host, {
  onPick(part) {
    if (selected) {
      viewer.setPartState(selected.id, [], []);
    }
    selected = part;
    if (part) {
      viewer.setPartState(part.id, [], [part.node]);
      console.log(models.get(part.id)!.tree[part.node]!.name);
    }
  },
});

viewer.subscribe({ loaded: (model) => models.set(model.summary.id, model) });
```

`samples/vite` is this, with a status line.

### Opening a model from a URL

Fetch it and pass a `File`:

```ts
const response = await fetch('/models/bracket.step');
viewer.importFiles([new File([await response.blob()], 'bracket.step')]);
```

### Living on someone else's page

A viewer reaches outside its element only if you ask it to:

| Option | Off unless you set it |
|---|---|
| `keys: true` | J3D's keys, while the pointer or focus is in the viewer. `'page'` takes them wherever they're pressed. `keyFilter` lets your page keep a key. |
| `keep: { name: 'my-app' }` | Keeps models in the browser's private storage across visits, in that folder. Call `restoreScene()`, then `restoreModels(scene.models)`, as the page opens. |

What's inside its element is on, and each piece can be turned off: `viewCube`, `homeButton`, `viewButtons` and `dropFiles`. The viewer styles its own elements with `j3d-` classes, which you can override. Two viewers can share a page, each with its own `keep` name.

### Cross-origin isolation

Nothing needs it. If your host sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, stopping a STEP or BREP export also stops the work in its worker. Without them the export finishes there and its result is dropped.

## A Blazor app, with `J3D.Blazor`

`J3D.Blazor` works under **Interactive WebAssembly**, with prerendering. Interactive Server isn't supported: every pick and hover would cross the network.

```bash
dotnet new blazor --interactivity WebAssembly --name MyViewer --empty
```

```bash
cd MyViewer
```

NuGet can't install from a URL, so download the package into a folder:

```bash
curl -L --create-dirs -o packages/J3D.Blazor.0.1.0.nupkg https://github.com/JRB-90/j3d/releases/download/v0.1.0/J3D.Blazor.0.1.0.nupkg
```

Name that folder in a `nuget.config` beside the solution. `J3D.Blazor` isn't on nuget.org, so the mapping makes sure that's never where it comes from:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="j3d" value="packages" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="j3d">
      <package pattern="J3D.Blazor" />
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
</configuration>
```

```bash
dotnet add MyViewer.Client package J3D.Blazor --version 0.1.0
```

Register its services in **both** projects' `Program.cs`, since the page prerenders on the server first:

```csharp
using J3D.Blazor;

builder.Services.AddJ3DBlazor();
```

Move `Components/Pages/Home.razor` from the server project to `Pages/Home.razor` in the client, and make it the viewer. There's nothing to add to `App.razor`: the component loads its own script.

```razor
@page "/"
@rendermode InteractiveWebAssembly
@using J3D.Blazor
@inject ViewerSession Session

<input @ref="_files" type="file" multiple />
<J3DViewer style="display: block; height: 80vh" OnReady="AttachFilesAsync" />

@code {
    private ElementReference _files;

    private Task AttachFilesAsync(ViewerCapabilities capabilities) => Session.AttachFileInputAsync(_files);
}
```

```bash
dotnet run --project MyViewer
```

Any attribute you put on `<J3DViewer>` goes on its element, which needs a size.

### Selecting, undo and the tree

These are already written, in `SceneState`. Inject it, read what you want to show, and listen to `Changed`:

```razor
@implements IDisposable
@inject SceneState Scene

<p>@Picked</p>
<button disabled="@(!Scene.CanUndo)" @onclick="Scene.Undo">Undo</button>

@code {
    private string Picked => Scene.Selection is [var (model, node), ..]
        ? model.Tree?.NameOf(node) ?? model.Summary.FileName
        : "Nothing selected";

    protected override void OnInitialized() => Scene.Changed += Refresh;

    public void Dispose() => Scene.Changed -= Refresh;

    private void Refresh() => _ = InvokeAsync(StateHasChanged);
}
```

`SceneState` holds commands for selecting, hiding, measuring, moving, cutting, pasting and more. `ViewerSession` holds what talks to the running viewer: fitting, the projection and exports. `samples/blazor` is a whole app.

### Options

`<J3DViewer>` takes what `createViewer` does:

| Parameter | What it does |
|---|---|
| `Keys` | `ViewerKeys.InViewer` or `ViewerKeys.Page`. Off unless set. |
| `PauseKeysWhile` | A CSS selector: while it matches, the viewer leaves keys alone, for a menu or dialog of yours. |
| `Keep` | A name: keeps models across visits, in that folder. Restoring is automatic. Off unless set. |
| `ViewCube`, `HomeButton`, `ViewButtons`, `DropFiles` | On unless set to `false`. |
| `OnReady` | The viewer has started, with what the browser gives it. `ViewerSession` can use it from here. |
| `OnNotice` | Something your page should tell its user, with a kind, a severity and an English message. Show them however you show things. |
| Child content | Drawn over the view, for your own panels. |

Open one `<J3DViewer>` at a time in a scope: a second fails at its first render.

## Licences

`@j3d/viewer` and `J3D.Blazor`'s own code are under the MIT License. `@j3d/occt`, and the OCCT WebAssembly inside `J3D.Blazor`, are under the LGPL 2.1 with the Open CASCADE exception, which is why `J3D.Blazor` declares `MIT AND LGPL-2.1-only`.

Each package holds a `THIRD-PARTY-NOTICES.md` for what it ships, with the licence texts. If you pass an app on to others, those notices go with it, and the kernel has to stay a separate file someone could replace. Bundlers and Blazor both leave it as one, and the recipe that rebuilds it is in [`src/J3D.Occt`](../src/J3D.Occt/BUILDING.md).

This is a description of how things are arranged, not legal advice.

## Moving to a newer version

All three packages share a version, and a version's files name each other. Change the version in the viewer's URL and reinstall. For Blazor, download the new `.nupkg` into your folder and change `Version`. Versions before 1.0.0 can change the API.
