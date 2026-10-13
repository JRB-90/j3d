# J3D.Occt — custom OCCT WebAssembly build

**Status: placeholder — lands in milestone M1** (see [docs/plan.md](../../docs/plan.md#61-occt-webassembly-build-srcj3docct)).

This package will hold, following Replicad's approach:

| File | Purpose |
|---|---|
| `package.json` | npm workspace `@j3d/occt`; devDependency `@libcascade/toolchain` |
| `libcascade.config.ts` | `defineBuild(...)`: trimmed OCCT 8.0.1 symbol set, `single` + `multi` variants, Emscripten settings |
| `wrappers/j3d_facade.cpp` | Project-owned C++ facade (`scope: 'main'` embind): import, mesh, extract buffers/tree/colours |
| `wrappers/j3d_facade.d.ts` | Hand-written TypeScript declarations for the facade |
| `dist/` | Built `j3d_occt_{single,multi}.{js,wasm,d.ts}` + provenance — committed, `*.wasm` via Git LFS |

Building needs a container engine (Docker) and runs in GitHub Actions (`.github/workflows/occt-wasm.yml`).
Everyday development uses the committed `dist/` and needs neither.
