# Developing J3D

How to build, run and test J3D, rebuild its OCCT WebAssembly, and use the CI. The design and every decision behind it
are in [plan.md](plan.md); this page is the practical side.

## Prerequisites

- **.NET SDK 10.0.402** or a later 10.0.4xx (`global.json` rolls forward within the feature band).
- **Node.js 22+** (npm workspaces drive the TypeScript viewer and the OCCT package).
- **Git LFS** (`git lfs install` before cloning): the OCCT WebAssembly binaries in `src/J3D.Occt/dist/` are stored in LFS.
- **PowerShell** (`pwsh`), only to run Playwright's browser installer for the E2E tests.
- *Optional:* **Docker**, only to rebuild the OCCT WebAssembly locally (CI normally does it) or to run the Firefox E2E
  tests in Linux.

## Layout

| Path | What |
|---|---|
| `src/J3D.Web` | ASP.NET Core host: static assets with cross-origin isolation headers, the prerendered shell |
| `src/J3D.Web.Client` | Blazor WebAssembly UI (MudBlazor): toolbar, model list, About, the interop wrappers and state |
| `src/J3D.Web.Client/scripts` | The app's browser code (`@j3d/client-scripts`): the bridge from `@j3d/viewer` to .NET, and the layout's touch handling. Its Vite build is what the browser loads |
| `src/J3D.Viewer` | `@j3d/viewer`: the Three.js viewer, the import pipeline and its mesh and store workers |
| `src/J3D.Occt` | `@j3d/occt`: the custom OCCT WebAssembly build (libcascade toolchain), its C++ facade, and the model worker with its main-thread API ([README](../src/J3D.Occt/README.md)) |
| `tests/J3D.Web.Client.Tests` | xUnit v3 + bUnit: components, state, interop JSON, the third-party notices |
| `tests/J3D.Web.Tests` | xUnit v3 + WebApplicationFactory: the host's headers and MIME types |
| `tests/J3D.E2E.Tests` | xUnit v3 + Playwright: the real app in Chromium and Firefox |
| `tests/fixtures` | Generated, licence-free CAD and mesh files shared by every test ([README](../tests/fixtures/README.md)) |

## Build and run

```bash
dotnet run --project src/J3D.Web --launch-profile https
```

`dotnet build` runs `npm ci` the first time, then compiles `@j3d/occt` and `@j3d/viewer` into their `lib/` folders and
bundles what they'd ship with the app's bridge, into `src/J3D.Web.Client/wwwroot/viewer/` (all git-ignored). Typechecks
and Vitest read the packages' sources through the `j3d-source` export condition, so they need no build. The
static-assets manifest is fixed at build time, so rebuild after changing the viewer before running the app again. To
work on the viewer with a watch build, run both of these alongside and skip it in MSBuild:

```bash
npm run dev --workspace @j3d/viewer
```

```bash
npm run dev --workspace @j3d/client-scripts
```

```bash
dotnet build J3D.slnx -p:SkipViewerBuild=true
```

In Development the host also renders a `<meta name="j3d-test-hook">`, which turns on the viewer's test hook
(`window.__j3dTest`, `src/J3D.Viewer/src/test-hook.ts`, reached through `@j3d/viewer/testing`): the E2E tests drive and
inspect the viewer through it.

The app keeps imported models in the browser's origin private file system and imports them again on every load
(docs/plan.md §6.2). To start from an empty scene, use **Clear all** above the model list, or clear the site's data for
the dev server's origin in the browser. Only one tab keeps models, so a second tab of the dev server starts empty. Each
E2E test runs in a fresh browser context, so it starts with an empty store.

## Tests

| Suite | Command |
|---|---|
| TypeScript typecheck and Vitest (viewer, and OCCT's integration tests on the real WebAssembly under Node) | `npm run typecheck && npm test` |
| Client (xUnit + bUnit) | `dotnet test --project tests/J3D.Web.Client.Tests` |
| Host | `dotnet test --project tests/J3D.Web.Tests` |
| E2E (Playwright) | `dotnet test --project tests/J3D.E2E.Tests` |

The build treats warnings as errors and enforces `.editorconfig` and the analyzers (including the trim analyzer on the
client), so a clean build is part of passing.

### End-to-end tests

Install Playwright's browsers once, after a build:

```bash
pwsh tests/J3D.E2E.Tests/bin/Debug/net10.0/playwright.ps1 install chromium firefox
```

Then choose the browser with `BROWSER` (`chromium` or `firefox`) and, if you like, filter by class:

```bash
BROWSER=chromium dotnet test --project tests/J3D.E2E.Tests --filter-class "*ModelListTests"
```

- By default the tests host the app in process on a random port. Set **`J3D_E2E_APP`** to a published app's folder to
  test that instead, trimmed as it ships, which is what CI does:

  ```bash
  dotnet publish src/J3D.Web -c Release -o /tmp/j3d-app
  ```

  ```bash
  J3D_E2E_APP=/tmp/j3d-app dotnet test --project tests/J3D.E2E.Tests -c Release
  ```

  Give it an absolute path: the test process resolves a relative one from its own folder.

- `HEADED=1` shows the browser. Firefox in CI runs headed under `xvfb-run` and one test class at a time (decision D51).
- A failed pixel check saves the screenshots it sampled under the test output's `screenshots/` folder.
- `J3D_STRESS=50` runs the opt-in `StressTests` for that many rounds: a measurement, then a model's Delete, which must
  open its dialog every time (decision D140); and pasting into the expanded `plant.step` then reloading, every other
  round at once, perhaps while the store is writing, after which the kept model must come back (D200).
- Safari isn't supported, so Playwright's WebKit isn't tested (D137, D138).
- Phones and tablets (M19, D211): `TouchTests` run in Chromium's emulation of a Pixel 7 (a touch screen and a mobile
  user agent), with long presses sent as touch events through the DevTools protocol; Playwright can't make Firefox a
  mobile device, so they're skipped there, and `CompactLayoutTests` check the compact layout by size in both browsers.

### On an Android phone

The phone reaches the app on the PC over USB as `localhost`, which is a secure context (D241): OPFS and the Web Locks
API, which keep the models, aren't available to `http://` the PC's address. With USB debugging on (the phone's
Developer options) and Android's platform-tools installed (`winget install Google.PlatformTools`):

```bash
dotnet run --project src/J3D.Web --launch-profile http
```

```bash
adb reverse tcp:5274 tcp:5274
```

Open `http://localhost:5274` in any of the phone's browsers. `chrome://inspect#devices` on the PC opens DevTools on the
phone's page (Chrome and Edge); Firefox's `about:debugging` does the same for Firefox on Android.

### Firefox in Docker

Playwright's Firefox doesn't start on some Windows builds ("side-by-side configuration is incorrect"). Its E2E job can
run as CI runs it instead: in Playwright's Linux image (Ubuntu 26.04, with Firefox, Xvfb and the .NET 10 runtime),
headed on a virtual display and a test class at a time, against a build and a published app made on the host (D139).
With Docker running, from the repository root:

```bash
dotnet build tests/J3D.E2E.Tests -c Release
```

```bash
dotnet publish src/J3D.Web -c Release -o artifacts/e2e-app
```

```bash
docker run --rm --init --ipc=host -v "${PWD}:/j3d" -w /j3d -e BROWSER=firefox -e HEADED=1 -e J3D_E2E_APP=/j3d/artifacts/e2e-app mcr.microsoft.com/playwright/dotnet:v1.63.0-resolute xvfb-run --auto-servernum dotnet tests/J3D.E2E.Tests/bin/Release/net10.0/J3D.E2E.Tests.dll -parallelMode none
```

- The `docker run` line works in PowerShell and in Linux and macOS shells; in Git Bash put `MSYS_NO_PATHCONV=1` in
  front of it.
- It runs the test executable itself, so the options are xUnit's own: `-class "*ExportTests"` picks a class,
  `-showLiveOutput` shows the tests' reports, and `-e J3D_LARGE_FIXTURES=200` or `-e J3D_STRESS=50` (before the image
  name) turns on the opt-in tests.
- The image's tag must match the `Microsoft.Playwright` version in `Directory.Packages.props`, since the image carries
  that version's browsers. Its SDK is older than `global.json` asks for, so it doesn't build anything; instead a
  Windows build of the tests also carries Playwright's Linux driver (`PlaywrightPlatform` in the test project).

### Large models

Large STEP files are generated, never committed. `200` makes `large-200mb.step`, thousands of copies of a simple block
(heavy to parse, cheap to mesh), and `curved-100` makes `curved-100mb.step`, copies of a filleted, lofted and drilled
part (heavy to mesh):

```bash
npm run fixtures:large -- 200 curved-100
```

Name the same files in `J3D_LARGE_FIXTURES` to run the Node test (`src/J3D.Occt/src/large.test.ts`) and the E2E test
(`LargeModelTests`), which also reports draw calls, frame cost, the longest main-thread task and the tree's opening
time. Headless browsers draw in software, so its rendering numbers only compare runs with each other. Both also export
each loaded file as STEP and BREP, after cancelling a STEP export part-way, and report the times and sizes (D141).

```bash
J3D_LARGE_FIXTURES=200,curved-100 npm test --workspace @j3d/occt -- large
```

The two assemblies, the generated `plant-10000` (10,122 parts, D161) and the real `so101` arm (D160), are made the same
way (`npm run fixtures:large -- plant-10000 so101`; see `tests/fixtures/README.md`). On them `LargeModelTests` also
edits the model (D201): a click in each selection mode, typed moves of the model and of the tree's first
sub-assembly with their undo, pasting, deleting and undoing a copy of it, Expand all with its undo and redo, the
edited STEP (imported again, every part counted) and BREP, and a reload, after which the model must come back with
its edits. It reports each step's time and longest task but asserts only what the step did:

```bash
J3D_LARGE_FIXTURES=plant-10000,so101 dotnet test --project tests/J3D.E2E.Tests --filter-class "*LargeModelTests" --output Detailed
```

CI runs it only when dispatched with `large_fixtures` (§9 of the plan):

```bash
gh workflow run ci.yml --ref <branch> -f large_fixtures=plant-10000,so101
```

### Threading benchmark

Spike S4 compares the single- and multi-threaded OCCT builds on the same files, one fresh Node process per import:

```bash
npm run benchmark:threads --workspace @j3d/occt -- large/large-25mb.step large/curved-25mb.step
```

Single-threaded stays the default unless the multi-threaded build is at least 1.3× faster on CI's 4-core runner
(decisions D28, D69). The M5 results are in [plan.md §10](plan.md).

## The OCCT WebAssembly

`src/J3D.Occt/dist/` holds the built glue, types and `.wasm` files and is committed. Day-to-day work never rebuilds it.
Changing `libcascade.config.ts` or the C++ in `wrappers/` needs a rebuild:

- **In CI:** push the change. The **OCCT WASM** workflow builds both variants, runs the OCCT tests, commits `dist/` back
  to the branch and then runs CI on that commit. It also runs when `src/J3D.Occt/package.json` changes; if the change
  can't affect the build (a new npm script, say), cancel it, since the output carries a build timestamp and it would
  commit a fresh `dist/` anyway.
- **Locally**, with Docker running (a compile error shows in about 30 seconds; a full link takes 6–7 minutes a variant):

  ```bash
  npm run build:wasm --workspace @j3d/occt
  ```

CI fails if `dist/` wasn't built from the current config and C++ (`npm run check:dist --workspace @j3d/occt`).
`src/J3D.Occt/**` is checked out with LF line endings everywhere so those hashes are stable. The constraints the
toolchain puts on the facade's C++ are listed in [plan.md §6.1](plan.md).

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`, on `ubuntu-26.04` (pinned, D68, D131):

1. **Build & unit tests:** the OCCT staleness check, typecheck, Vitest (including the OCCT integration tests), a
   Release build, and the client and host tests.
2. **E2E**, one job per browser: publish the app and run the Playwright suite against it (D65). Firefox runs headed under
   Xvfb, a class at a time. Failed pixel checks upload their screenshots as `e2e-screenshots-<browser>`.

Run it by hand with extra inputs (`gh workflow run ci.yml --ref <branch> -f <input>=<value>`):

| Input | Effect |
|---|---|
| `large_fixtures` | Generates these large files (e.g. `200,curved-100`) and runs the large-model tests in every job |
| `browser` | Runs E2E in one browser only. Dispatched runs don't cancel each other, so a flaky job can be repeated side by side. |
| `threads_benchmark` | Runs only the threading benchmark on these files (e.g. `large/large-25mb.step large/curved-25mb.step`), with the tables in the job summary |

`.github/workflows/occt-wasm.yml` is the OCCT build described above.

## Conventions

- One branch and one pull request per milestone, squash-merged into `main` (D37).
- C#: file-scoped namespaces, nullable, primary constructors for DI (Razor components included), records for DTOs,
  string enums across interop. The full list is in [plan.md §6.4](plan.md).
- Only `ViewerInterop` talks to the viewer module; mesh data never crosses into .NET.
- Every fixture is generated by a script in the repository, so all of them are licence-free.
- A new runtime dependency needs an entry in `ThirdParty.Components` and in `THIRD-PARTY-NOTICES.md`; a test checks
  both against the package manifests.
