# J3D.Blazor

A Blazor WebAssembly component that views CAD and mesh models in the browser. It opens STEP, IGES and BREP files with the OCCT kernel compiled to WebAssembly, and STL, OBJ and glTF meshes. `<J3DViewer>` comes with `SceneState`, which keeps the selection, visibility, undo and tree edits, and you build your own UI on that. It has no MudBlazor in it.

It works under Interactive WebAssembly, with prerendering. Interactive Server isn't supported.

## Install

It's a file on a [GitHub Release](https://github.com/JRB-90/j3d/releases), not on nuget.org. NuGet can't install from a URL, so download the `.nupkg` into a folder and name that folder in your `nuget.config`. [`docs/library.md`](https://github.com/JRB-90/j3d/blob/main/docs/library.md) has the steps, and the `nuget.config` to use.

## Use

Register its services in **both** projects' `Program.cs`, since the page prerenders on the server first:

```csharp
builder.Services.AddJ3DBlazor();
```

Then, on a page in the client project:

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

The component loads its own script, so there's nothing to add to `App.razor`. It fills its element, so give that a size. `SceneState` holds what's selected and the commands to change it, and `ViewerSession` holds what talks to the running viewer. Both come with comments on every member.

[`samples/blazor`](https://github.com/JRB-90/j3d/tree/main/samples/blazor) is a working app.

## Licence

The library's own code is MIT. Its bundle includes the OCCT WebAssembly as a separate file, under the LGPL 2.1 with the Open CASCADE exception, so it declares `MIT AND LGPL-2.1-only`. See `LICENSE` and `THIRD-PARTY-NOTICES.md`.
