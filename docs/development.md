# Developing J3D

How to build, run and test J3D, rebuild its OCCT WebAssembly, and use the CI. The design and every decision behind it
are in [plan.md](plan.md); this page is the practical side.

## Prerequisites

- **.NET SDK 10.0.402** or a later 10.0.4xx (`global.json` rolls forward within the feature band).
- **Node.js 22+** (npm workspaces drive the TypeScript viewer and the OCCT package).
- **Git LFS** (`git lfs install` before cloning): the OCCT WebAssembly binaries in `src/J3D.Occt/dist/` are stored in LFS.
- **PowerShell** (`pwsh`), only to run Playwright's browser installer for the E2E tests.
- *Optional:* **Docker**, only to rebuild the OCCT WebAssembly locally. CI normally does it.

## Layout

| Path | What |
|---|---|
| `src/J3D.Web` | ASP.NET Core host: static assets with cross-origin isolation headers, the prerendered shell |
| `src/J3D.Web.Client` | Blazor WebAssembly UI (MudBlazor): toolbar, model list, About, the interop wrappers and state |
| `src/J3D.Viewer` | TypeScript: the Three.js viewer, the import pipeline and its workers |
| `src/J3D.Occt` | The custom OCCT WebAssembly build (libcascade toolchain), its C++ facade and typed wrapper ([README](../src/J3D.Occt/README.md)) |
| `tests/J3D.Web.Client.Tests` | xUnit v3 + bUnit: components, state, interop JSON, the third-party notices |
| `tests/J3D.Web.Tests` | xUnit v3 + WebApplicationFactory: the host's headers and MIME types |
| `tests/J3D.E2E.Tests` | xUnit v3 + Playwright: the real app in Chromium, Firefox and WebKit |
| `tests/fixtures` | Generated, licence-free CAD and mesh files shared by every test ([README](../tests/fixtures/README.md)) |

## Build and run

```bash
dotnet run --project src/J3D.Web --launch-profile https
```

`dotnet build` runs `npm ci` the first time, then the viewer's Vite build, whose output goes to
`src/J3D.Web.Client/wwwroot/viewer/` (git-ignored). The static-assets manifest is fixed at build time, so rebuild after
changing the viewer before running the app again. To work on the viewer with a watch build, run it alongside and skip
it in MSBuild:

```bash
npm run dev --workspace @j3d/viewer
```

```bash
dotnet build J3D.slnx -p:SkipViewerBuild=true
```

In Development the host also renders a `<meta name="j3d-test-hook">`, which turns on the viewer's test hook
(`window.__j3dTest`, `src/J3D.Viewer/src/test-hook.ts`): the E2E tests drive and inspect the viewer through it.

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
pwsh tests/J3D.E2E.Tests/bin/Debug/net10.0/playwright.ps1 install chromium firefox webkit
```

Then choose the browser with `BROWSER` (`chromium`, `firefox` or `webkit`) and, if you like, filter by class:

```bash
BROWSER=webkit dotnet test --project tests/J3D.E2E.Tests --filter-class "*ModelListTests"
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
- Playwright's Firefox doesn't start on some Windows builds ("side-by-side configuration is incorrect"); CI covers it.

### Large models

Large STEP files are generated, never committed. `200` makes `large-200mb.step`, thousands of copies of a simple block
(heavy to parse, cheap to mesh), and `curved-100` makes `curved-100mb.step`, copies of a filleted, lofted and drilled
part (heavy to mesh):

```bash
npm run fixtures:large -- 200 curved-100
```

Name the same files in `J3D_LARGE_FIXTURES` to run the Node test (`src/J3D.Occt/src/large.test.ts`) and the E2E test
(`LargeModelTests`), which also reports draw calls, frame cost, the longest main-thread task and the tree's opening
time. Headless browsers draw in software, so its rendering numbers only compare runs with each other.

```bash
J3D_LARGE_FIXTURES=200,curved-100 npm test --workspace @j3d/occt -- large
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

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`, on `ubuntu-24.04` (pinned, D68):

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
