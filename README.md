# j3d
Web based 3D environment based on the OCCT BREP kernel.

J3D imports CAD models (STEP, IGES, BREP, plus STL/OBJ/glTF meshes) and displays them in the browser.
OCCT 8 runs client-side as WebAssembly, rendering uses Three.js, and the UI is Blazor (.NET 10, C# 14) with MudBlazor.
CAD files never leave your machine.

**Status:** iteration 1 in progress. See [docs/plan.md](docs/plan.md) for the architecture, decisions and milestones.

## Prerequisites

- .NET SDK 10.0.301+ (`global.json`)
- Node.js 22+ (npm workspaces drive the TypeScript viewer build)
- Git LFS (`git lfs install`), because the OCCT WebAssembly binaries are stored in LFS
- *Optional:* Docker, only for rebuilding the OCCT WASM locally (CI normally does this)

## Run

```bash
dotnet run --project src/J3D.Web --launch-profile https
```

`dotnet build` runs `npm ci` (first time) and the Vite build automatically. To work on the viewer with a watch build,
run `npm run dev --workspace @j3d/viewer` and build .NET with `-p:SkipViewerBuild=true`.

## Test

```bash
npm test
```

```bash
dotnet test --project tests/J3D.Web.Client.Tests
```

```bash
dotnet test --project tests/J3D.Web.Tests
```

End-to-end tests need Playwright browsers once (`pwsh tests/J3D.E2E.Tests/bin/Debug/net10.0/playwright.ps1 install`), then:

```bash
dotnet test --project tests/J3D.E2E.Tests
```

## Layout

| Path | What |
|---|---|
| `src/J3D.Web` | ASP.NET Core host (static assets, cross-origin isolation headers) |
| `src/J3D.Web.Client` | Blazor WebAssembly UI |
| `src/J3D.Viewer` | TypeScript: Three.js viewer and OCCT worker pipeline |
| `src/J3D.Occt` | Custom OCCT WebAssembly build (libcascade toolchain) |
| `tests/` | xUnit v3 / bUnit / Playwright tests and shared fixtures |
