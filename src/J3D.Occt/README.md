# J3D.Occt — custom OCCT WebAssembly build

OCCT 8.0.1 compiled to WebAssembly with the [libcascade toolchain](https://www.npmjs.com/package/@libcascade/toolchain),
following Replicad's approach: a trimmed build plus project-owned C++ wrappers. Design notes: [docs/plan.md §6.1](../../docs/plan.md#61-occt-webassembly-build-srcj3docct).

| Path | Purpose |
|---|---|
| `libcascade.config.ts` | Build config: bound symbols, Emscripten settings, `single` (default) and `multi` variants |
| `wrappers/j3d_facade.cpp` | C++ facade: `J3DModel` (import → mesh → scene/prototypes; measuring, M7; STEP and BREP export, M9) and `J3DMeshData` (buffers) |
| `src/facade.ts` | Typed wrapper: `OcctModel.load(module, source, format, fileName, options)` |
| `src/facade.test.ts` | Integration tests: the real WASM under Node against `tests/fixtures` (also `measure.test.ts` and `export.test.ts`) |
| `dist/` | Built `j3d_occt_{single,multi}` glue, `.wasm` (Git LFS), types, provenance. **Committed, never hand-edited.** |
| `scripts/check-dist.mjs` | Fails if `dist/` wasn't built from the current config and C++ (used by CI) |
| `scripts/generate-fixtures.mjs` | Regenerates the OCCT fixtures in `tests/fixtures` |
| `scripts/generate-large-step.mjs` | Writes large STEP files (block or curved copies) into the git-ignored `tests/fixtures/large/` (`npm run fixtures:large`) |
| `scripts/benchmark-threads.mjs` | Spike S4: imports files with both variants, one process per import, and compares them phase by phase (`npm run benchmark:threads`) |

## Commands

Everyday work uses the committed `dist/` and needs no container:

```bash
npm test --workspace @j3d/occt
```

Changing the config or C++ needs a rebuild, which requires Docker (about 6–7 minutes per variant):

```bash
npm run build:wasm --workspace @j3d/occt
```

Pushing changes to `libcascade.config.ts` or `wrappers/` also triggers the **OCCT WASM** workflow, which rebuilds,
tests and commits `dist/` itself. CI fails while `dist/` is stale:

```bash
npm run check:dist --workspace @j3d/occt
```

## Writing facade C++

The bindgen binds every top-level class in `wrappers/`. Keep helpers as **private nested classes** and free
functions `inline`; include `emscripten.h` only under `__has_include`. See the plan's "Toolchain constraints" list.
