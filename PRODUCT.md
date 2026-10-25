# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The owner, first** (Jake Brown), using J3D for **personal projects**: their own hobby designs and 3D-printing models,
opened in a desktop browser to look at, measure exactly, rearrange and export. Future work optimises for this one
experienced user's workflow.

**Secondary:** people who clone and run the open-source project themselves. They're welcome, and the tool should be
dependable for them, but they don't outrank the owner's workflow.

No other audience is confirmed: not engineering teams, suppliers or reviewers, and not the general public (decided
2026-10-25).

## Product Purpose

J3D is a 3D CAD viewer that runs entirely in the browser. It opens STEP, IGES and BREP with the Open CASCADE Technology
(OCCT) kernel compiled to WebAssembly, and STL, OBJ and glTF meshes with three.js. It exists so the owner can inspect,
measure and arrange their own models with their exact geometry, without installing a CAD package.

Success is **a solid, self-run MIT open-source tool**: one the owner reaches for on their own projects, and one that
works dependably for anyone who clones and runs it. Public hosting isn't the aim. Deployment stays local-only (plan
D25, D75), and any hosted version would be a later decision, after the LGPL/Open CASCADE review.

## Positioning

**Exact BREP in a browser tab.** Real OCCT runs in WebAssembly, so a CAD model keeps its true geometry. Its true BREP
edges are drawn over its shaded faces. Measurements are computed exactly from its faces, edges and vertices. It is
written back out as STEP or BREP. None of this needs an install. A mesh-based viewer can show the shape but can't
truthfully claim exact measurement or STEP written back.

Mesh formats are supported but stay second-class: they're labelled **mesh** models, have no BREP edges, and are
measured only approximately (marked ≈).

The owner did not choose these as the headline (2026-10-25), although each is true as built: files never leaving the
machine, large-assembly scale, and arranging assemblies and writing them back.

## Operating Context

- **Where it runs:** current desktop Chrome, Edge and Firefox, with WebGL 2 and a cross-origin-isolated page
  (COOP/COEP headers from the host). Safari isn't supported (D137). It isn't hosted: users run it locally with
  `dotnet run --project src/J3D.Web`.
- **The workflow:** import files with the **Import** button, or drop files or whole folders onto the view. Each file
  becomes a **model** in the list, with progress and a cancel button, then its stats and its assembly tree. From there
  the user:
  - selects at the **Model**, **Object** or **Feature** level;
  - hides, isolates and shows parts;
  - measures from a reference;
  - moves objects with the triad or by typing values;
  - exports the scene or the selection.
- **Navigation:** left-drag or middle-drag pans, right-drag rotates (turntable, Z stays up), and the wheel zooms toward
  the pointer. The view is orthographic by default. A view cube (top right) gives 26 standard views, and **Home** gives
  an isometric view with everything fitted. Most commands also have single-key shortcuts (`F`, `H`, `I`, `M`, `W`,
  `E`, `O`, `1`–`3`, `Esc`, `Ctrl+Z`/`Ctrl+Y`).
- **Sessions:** imported files are kept in the browser's private storage (OPFS) and imported again on the next visit,
  with what was hidden, what was moved, and the camera. Only one tab keeps models.

## Capabilities and Constraints

**As built (through M13):**

- Import from STEP, IGES, BREP, STL, OBJ and glTF/GLB.
- Shaded faces in the file's colours (translucency included) under the true BREP edges.
- A read-only assembly tree with eye toggles.
- Selection at three levels.
- Exact BREP measurement, approximate for meshes.
- Moving objects in a Local, Parent or World frame, and origin frames.
- Undo and redo.
- Persistence, as described under Sessions.
- Export of the scene or the selection as GLB or STL, and of a CAD model as STEP or BREP.

**Planned (iteration 3, M14–M16):**

- Assembly editing: re-parent, copy, paste, delete and group.
- Exporting the edited assembly, or just the selection, as STEP or BREP.
- **Expand**: turning a compound part into one part per solid.
- Large-assembly hardening.

**Constraints:**

- **All processing happens in the browser today.** There's no server-side processing, no uploads, no analytics, and
  nothing is loaded from other sites, because cross-origin isolation forbids it. Fonts, scripts and decoders are
  self-hosted. The README states this as a promise. The owner hasn't made it a binding rule for future features, but
  a feature that changes it has to change that claim too.
- Each CAD model gets its own WebAssembly heap of up to 4 GB, which puts the ceiling at roughly 550–600 MB of STEP. A
  file over the limit fails with a clear "too large" error rather than a crash.
- Edits change placements and structure, never shapes (D144).
- Lengths are in millimetres, to 3 decimals, and angles are in degrees, to 2. The scene is Z-up. Mesh values are
  prefixed ≈.
- The layout is desktop only today. Phone and tablet layouts are out of scope for iteration 3, but the owner hasn't
  ruled them out for later. Touch input works.
- **Dropped for good** (D143): users and auth, sectioning, keeping measurements or selections, and editing geometry.
- **Licensing:** J3D is MIT. OCCT is LGPL-2.1 with the Open CASCADE exception. The About dialog has to keep its
  licence, third-party list and OCCT notice, and a test keeps them in step with `THIRD-PARTY-NOTICES.md`.

**Terminology:**

| Term | Meaning |
|---|---|
| **model** | One imported file: a CAD (BREP) model or a **mesh** model |
| **object** | A placed **part** or a **sub-assembly** |
| **feature** | A face, edge or vertex of a CAD model |
| **reference** | The first pick of a measurement, which later picks are measured against |
| **triad** | The arrows, planes and rings the Move tool shows |
| **origin frames** | X, Y and Z axes drawn at the selected objects' origins |
| **kept** | Saved in the browser's storage for the next visit |
| **Fit all**, **Home**, **Isolate**, **Show all**, **Clear all** | Command names used as written in the UI |
| **Parent**, **World**, **Local** | The frames that positions and turns are shown and typed in |

## Brand Commitments

- **Name:** J3D.
- **Dark only:** there's no light mode and no theme toggle (D15, confirmed binding 2026-10-25). The palette and type
  belong in DESIGN.md, not here.
- **Voice:** the README's plain voice is binding (2026-10-25):
  - **Language:** British English (colours, licence, millimetres).
  - **Exact:** units, keys, real numbers and real limits, stated plainly.
  - **Short labels:** names that say what a thing does. A tooltip carries its key, as in "Fit all (F)", and a
    confirmation names its object, as in "Delete *name*?".
  - **No marketing words.**
  - **Gaps stated plainly:** the README says outright what doesn't work yet ("Not in this version yet: …").

## Evidence on Hand

- `docs/screenshot.png`: the README screenshot, showing a two-plate assembly with its pin selected, a 35 mm
  measurement and the Export menu open.
- **Measured performance**, from the project's own tests (README "Limits"):
  - a 200 MB STEP of 10,000 parts loads in about 30 s and orbits at 60 fps on a laptop's integrated GPU;
  - it saves as STEP in about 12 s and as BREP in 2 s;
  - a STEP of about 600 MB saves as STEP in about half a minute.
- `tests/fixtures/`: licence-free fixtures that scripts generate. A real assembly is fetched by script (D156).
- **There are no users, testimonials, case studies, press, download counts, or hosted demo.** Future work must not
  invent any.

## Product Principles

1. **One real user's workflow comes first.** Features earn their place by being used on the owner's own projects, not
   by serving imagined audiences.
2. **Exactness is the point.** Values come from the BREP. Anything approximate is labelled ≈, and a mesh-derived or
   rounded number is never shown as exact.
3. **Say it plainly and exactly.** Use names, units, keys and limits. Be honest about what isn't built yet.
4. **Dependable for anyone who runs it.** Fail with a clear error rather than a crash. Long work shows its progress
   and can be cancelled. Edits can be undone. The README matches what ships.

## Accessibility & Inclusion

Today's level is the floor, with no formal WCAG target (decided 2026-10-25):

- Every command can be reached by a key, a toolbar button or a menu item.
- Icon-only buttons have accessible names and tooltips that show their key.
- Measurement labels are HTML over the canvas (D103), so screen readers and tests can read them.
- Touch input works in the 3D view.
