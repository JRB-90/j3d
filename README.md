# J3D

A 3D CAD viewer that runs entirely in your browser. J3D opens STEP, IGES and BREP files with the
[Open CASCADE Technology](https://dev.opencascade.org/) (OCCT) kernel compiled to WebAssembly, and STL, OBJ and
glTF meshes with [three.js](https://threejs.org/). **Your CAD files never leave your machine:** reading, meshing and
drawing all happen in the browser tab.

![J3D measuring the 35 mm gap between the plates of a two-plate assembly, with the labelled toolbar, the model list and the assembly's tree, and the measurement in the panel](docs/screenshot.png)

## What it does

- **Import** several files at once with the **Import** button, or drop files or whole folders onto the view.
- Each file becomes a **model** in the list on the left, with its progress while importing (and a cancel button), then
  the memory it takes, its triangle and part counts, any warnings, and its **assembly tree**. An empty view says what
  to drop and how the mouse moves the view.
- **Select** by clicking in the view or in the tree (Ctrl+click adds or removes), at one of three levels picked in
  the toolbar or with `1`, `2` and `3`: **Model** selects whole models, **Object** single parts (or, from the tree,
  sub-assemblies), and **Feature** the faces, edges and vertices of CAD models. Selected parts are highlighted in
  blue, named in a panel at the bottom left, and shown in the tree; selected features are listed in the panel with
  their values, and with the total length or area of several. What's under the pointer is highlighted faintly
  before you click.
- **Move** a part, a sub-assembly (picked in the tree) or a whole model (in Model mode): turn on **Move** (or press
  `W`) to drag the arrows and planes of a triad at the object's origin, or press `E` for its rings to turn it; hold
  `Ctrl` to snap to whole millimetres and 15°. The panel shows the object's position (X, Y, Z in mm) and turn (Rx,
  Ry, Rz in degrees, about X, then Y, then Z) in its **Parent**'s frame or the **World**'s; type new values and press
  Enter (or **Apply**) to put it there, or in **Local** type a move about the object's own axes; the panel says which
  ("Position in its parent", "Move by"). Moving one of several copies of a
  part or sub-assembly moves only that one. **Origin frames** (`O`) draws the X, Y and Z axes at the selected
  objects' origins. Moves can be undone and are kept for your next visit; a model's origin is its file's.
- **Rearrange** a model's assembly (in Object mode): **Cut**, **Copy** and **Paste** objects with the right-click menu
  or `Ctrl+X`, `Ctrl+C` and `Ctrl+V`; Paste puts copies in the same place, inside a selected assembly, just after a
  selected part, or else beside the originals, and selects them. Drag a node in the tree onto an assembly to move it
  there (onto the model's name for the top level), or hold `Ctrl` to copy it. **Delete** removes objects without
  asking, since **Undo** brings them back; an assembly left empty goes with them. **New assembly** (`Ctrl+G`) groups
  the selection where its parts are, and opens its name for typing; **Ungroup** (`Ctrl+Shift+G`) does the reverse, and
  **Rename** (`F2`) renames any node. Nothing moves in 3D. An edit acts on the selection's objects: select all of a
  sub-assembly's parts and it's the sub-assembly that's copied or deleted. Edits stay within one model, can be undone,
  and are kept for your next visit; in Model mode `Delete` deletes the selected models, after asking.
- **Expand** a CAD part that holds several solids (a compound, such as a bolt set saved as one part): right-click it
  and choose **Expand**, and it becomes a sub-assembly with one part per solid, keeping the names and colours the
  file gives them (others are numbered after the part: "Bolt set 1", "Bolt set 2"). **Expand all** does the same for
  every such part in the selected assemblies or models. Only the one you picked is split, not every copy of it, and
  it's an edit like the others: it can be undone, is kept, and is exported.
- **Right-click** a part, a tree node or empty space (a click that doesn't drag) for a menu of what you can do there:
  hide, isolate, move, measure from that point, edit and export the selection, or show all, fit all, paste and export
  the scene. Each command shows its key; `Esc` closes the menu.
- **Hide, isolate and show** parts with the eye beside each model and tree node, or the toolbar buttons and keys
  below. Isolating fits the view to what's left. **Undo and redo** cover hiding and showing, moving, editing the
  assembly, and deleting a model.
- **Measure** CAD models exactly from their BREP geometry: turn on **Measure** (or press `M`) and click a face, edge
  or vertex. That first pick is the **reference**: its own value is drawn on it (an edge's length, a circle's
  diameter, a face's area) and its properties (area, length, radius, normal, axis…) and its part's volume and size
  are listed in the panel. Each later click shows the reference against what it picked (the distance between them,
  the angle between planes or lines, the distance between circle centres), replacing the last result. A feature
  selected before you turn the tool on becomes the reference; `Esc` clears the measurement and turns the tool off.
  On mesh models the tool measures between points, snapping to vertices, and marks the results approximate (≈).
- **Delete** a model from the list. J3D asks first (with **Cancel** focused), then frees all of its memory; **Undo** brings it back into its
  place, imported again from its kept copy, with its hidden parts and moves.
- **Your models are kept** for your next visit: each imported file (with its buffers, materials and textures) is
  copied into the browser's private storage for this page, and when you come back the models are imported again in
  their order, with the parts you hid still hidden, the parts you moved where you put them, your edits to their
  assemblies, and the camera where you left it. **Clear all**, above the list,
  removes every model and everything kept. Only one tab keeps models: a second J3D tab says so and keeps nothing.
- **Export** what you see: the toolbar's **Export** saves every visible part, or only the selection when there is one,
  as **GLB** (with colours, the tree and the BREP edges) or **STL** (binary or ASCII, one uncoloured mesh). A CAD
  model's download icon in the list saves the whole model **as you've edited it**, as **STEP** (with its assembly,
  names and colours, its moves, copies and deletions, and without the parts you've hidden) or **BREP**, showing its
  progress in the list with a **Cancel** button; a model you haven't touched is saved exactly as imported. Parts of
  the assembly you didn't change stay shared in the file, so six identical robots are still one robot placed six
  times. When the selection lies in one CAD model, **Export** also offers STEP and BREP of just the selection, under
  its assemblies from the top. Files are saved where your browser saves downloads, named after their model (or
  `scene` / `selection` for several).
- CAD models are drawn with **shaded faces in the file's colours** and the **true BREP edges** over them; translucent
  colours are drawn translucent.
- The view is **orthographic** by default, with an **Orthographic | Perspective** switch under the view cube that keeps
  the framing.

### Formats

| Format | Extensions | What you get |
|---|---|---|
| STEP | `.step` `.stp` | Exact geometry through OCCT: colours (including transparency), names, the assembly tree, BREP edges |
| IGES | `.iges` `.igs` | As STEP |
| BREP | `.brep` | OCCT's own format: the shape, without colours |
| glTF | `.glb` `.gltf` | Embedded or multi-file `.gltf` (pick or drop its `.bin` and textures with it), Draco, meshopt and KTX2 compression |
| OBJ | `.obj` | With its `.mtl` and textures when you pick or drop them together |
| STL | `.stl` | Binary or ASCII |

Mesh formats are shown as **mesh** models: they have no BREP edges. glTF files are Y-up by definition and are turned
to J3D's Z-up; STL and OBJ are assumed to be Z-up already, as CAD exports are.

**Exported GLB and STL files are in millimetres and Z-up, as J3D shows them**, which suits taking them back into CAD
tools. glTF is meant to be in metres and Y-up, so other glTF viewers show J3D's GLB 1,000 times too big and lying on
its back; J3D marks its own GLB files and reads them back exactly as they were exported. A glTF model, which J3D
treats as metres, is exported 1,000 times larger, in millimetres.

## Controls

| Action | Mouse | Touch | Keys and buttons |
|---|---|---|---|
| Rotate (turntable, Z stays up) | Right-drag | One finger | Click a face, edge or corner of the **view cube** (top right) for one of 26 standard views |
| Pan | Left-drag or middle-drag | Two-finger drag | |
| Zoom | Wheel (towards the pointer) | Pinch | |
| Fit everything visible in view | | | **Fit all** in the toolbar, or `F` |
| Isometric view of everything | | | **Home**, beside the view cube |
| Select models, objects or features | | | The **Model**, **Object** and **Feature** switch in the toolbar, or `1`, `2`, `3` |
| Select | Click it (a click that doesn't drag) | Tap it | Click a node in the tree selects every part under it (its model in Model mode) |
| Add or remove | Ctrl+click | | Ctrl+click in the tree |
| Clear the selection | Click empty space | Tap empty space | `Esc` |
| Commands for what's under the pointer | Right-click (a click that doesn't drag) | | Right-click a node in the tree |
| Hide the selection | | | **Hide** in the toolbar, or `H`; or a node's eye in the tree |
| Show only the selection | | | **Isolate**, or `I` |
| Show everything | | | **Show all**, or `Shift+H` |
| Move the selected part, sub-assembly or model | Drag the triad's arrows or planes; `Ctrl` snaps | | **Move** in the toolbar, or `W`; type X, Y, Z in the panel and press Enter |
| Turn it | Drag the triad's rings; `Ctrl` snaps to 15° | | `E`; type Rx, Ry, Rz in the panel and press Enter |
| Show origin frames | | | **Origin frames** in the toolbar, or `O` |
| Cut, copy, paste the selected objects | | | Right-click menu, or `Ctrl+X`, `Ctrl+C`, `Ctrl+V` |
| Delete the selected objects (or, in Model mode, models) | | | Right-click menu, or `Delete` |
| Move a node to another assembly | Drag it in the tree onto the assembly, or the model's name | | Cut, select the assembly, Paste |
| Copy a node into another assembly | `Ctrl`+drag it in the tree | | Copy, select the assembly, Paste |
| Group the selection, or ungroup an assembly | | | **New assembly** (`Ctrl+G`), **Ungroup** (`Ctrl+Shift+G`) in the right-click menu |
| Rename a node | | | **Rename** in the right-click menu, or `F2`; `Enter` keeps it, `Esc` doesn't |
| Split a compound part into its solids | | | **Expand** (one part) or **Expand all** (an assembly's, or a model's) in the right-click menu |
| Undo, redo (hiding, showing, moving, editing, deleting) | | | **Undo**, **Redo**, or `Ctrl+Z`, `Ctrl+Y` |
| Measure | Click a face, edge or vertex (the reference), then others | Tap | **Measure** in the toolbar, or `M`; **Measure from here** in the right-click menu; `Esc` ends it |
| End the Move or Measure tool | | | `Esc` (again to clear the selection) |
| Export the scene or the selection | | | **Export** in the toolbar: GLB, STL (binary) or STL (ASCII), and STEP or BREP of a selection in one CAD model |
| Export a CAD model as edited | | | The model's download icon in the list: STEP or BREP |

The view fits itself to the first model you import into an empty scene; later imports leave the camera where it is,
and so do models coming back from your last visit or an undo.

## Limits

- Each CAD model gets its **own WebAssembly heap of up to 4 GB**. Reading a STEP file can take about seven times the
  file's size, so the practical ceiling is roughly **550–600 MB of STEP**; a larger file fails with a clear "too large"
  error rather than crashing. On a laptop, a 200 MB STEP of 10,000 parts loads in about 30 seconds and orbits at 60
  frames a second on its integrated GPU.
- Translucent parts are blended without sorting, so overlapping and intersecting ones look right from every angle, but
  closely stacked layers blend a little more evenly than real glass would. A GPU without float render targets (rare)
  falls back to sorting, which can draw intersecting parts in the wrong order.
- Kept models come back by being imported again, so a large file takes as long to return (after a refresh, or when
  its delete is undone) as it took to import: about 30 seconds for a 200 MB STEP. Selections, measurements and the
  undo history aren't kept across a refresh, and a measurement lasts only until the next click or `Esc`.
- Kept files count against the browser's storage for the page. When it's full, a model stays open for the visit and
  its list item says it wasn't kept. Browsers may also clear the storage of sites you haven't used for a while unless
  they grant it persistent storage, which J3D asks for (Firefox shows a prompt; Chrome decides by itself).
- Measurements are in millimetres: STEP and IGES are converted on import, glTF (metres by its specification) is
  converted when measured, and STL and OBJ are taken to be in millimetres.
- Exports are written in the browser too, in the model's own 4 GB heap. Writing needs far less memory than reading, so
  every model that loads also exports: the 200 MB STEP saves as STEP in about 12 seconds and as BREP in 2, and one of
  600 MB, about the largest that loads, as STEP in about half a minute. **Cancel** stops an export at once, although
  the last few seconds of writing a STEP file carry on unseen, and the model's next export waits for them.
- An edited CAD model's STEP is rebuilt from J3D's tree: names, colours, placements and the assembly come through, and
  so does anything the file attaches to the parts J3D keeps whole, but metadata on assemblies you've changed may not.
  BREP holds geometry only, so it has no names or colours. A top-level assembly is written at the origin, with its
  placement (and the model's, if you moved it) in its children. Objects can't be moved or copied from one model to
  another, and a model whose kept edits no longer fit it (if a new version of J3D reads its file differently) comes
  back as imported, with a warning in the list.
- Not in this version yet: sections, exploded views, and a phone or tablet layout.

## Browsers

J3D runs in current desktop **Chrome, Edge and Firefox**. It needs **WebGL 2** and a **cross-origin-isolated** page
(the host sends the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers for this).

| Browser | Tested |
|---|---|
| Chrome, Edge | Every change in CI (Playwright Chromium), and by hand on Windows |
| Firefox | Every change in CI (Playwright Firefox) |
| Safari | Not supported, and not tested |

Only the current version of each browser is tested.

## Privacy

Files go straight from the file picker or the drop into a Web Worker in your browser. J3D has no server-side
processing, uploads nothing, has no analytics, and loads nothing from other sites (its cross-origin isolation forbids
it). The copies it keeps for your next visit are in the browser's
[origin private file system](https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system),
on your machine, readable only by this page; **Clear all** deletes them, as does clearing the site's data in the
browser.

## Running it

J3D isn't hosted anywhere yet. To run it on your machine you need the .NET 10 SDK, Node.js 22+ and Git LFS:

```bash
git lfs install && git clone https://github.com/JRB-90/j3d.git && cd j3d
```

```bash
dotnet run --project src/J3D.Web --launch-profile https
```

Building, testing, rebuilding the OCCT WebAssembly and the CI are covered in [docs/development.md](docs/development.md).
The design, decisions and milestones are in [docs/plan.md](docs/plan.md).

## Licence

J3D is MIT-licensed ([LICENSE](LICENSE)). It makes use of the Open CASCADE Technology software (LGPL-2.1 with the Open
CASCADE exception) and other open-source components listed, with their licences, in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and in the app's **About** dialog.
