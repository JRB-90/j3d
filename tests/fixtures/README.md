# Test fixtures

**Status:** OCCT fixtures (BREP/STEP/IGES) added in M1; mesh fixtures arrive in M2 (see [docs/plan.md](../../docs/plan.md#8-testing-strategy)).

Shared by Vitest (OCCT integration tests under Node) and Playwright (browser E2E).

| Fixture | Format | Exercises |
|---|---|---|
| `box.brep` | BREP | Minimal OCCT round trip, single part, default colour |
| `coloured-part.step` | STEP | Per-face and per-part colours (XCAF) |
| `assembly.step` | STEP | Nested assembly, names, repeated instances (prototype meshed once) |
| `surfaces.iges` | IGES | IGES reader, colours via IGESCAFControl |
| `invalid.step` | STEP | Corrupt file → `ParseFailed` error path |
| `translucent.step` | STEP | RGBA colours: an opaque core inside a 40 % opaque cover |
| `part.stl` / `part.obj` / `part.glb` | Mesh | Three.js loader paths, glTF Y-up → Z-up conversion |
| `textured/part.obj` + `.mtl` + `.png` | Mesh | OBJ+MTL sidecar grouping and materials |
| `multi/scene.gltf` + `.bin` + textures | Mesh | Multi-file glTF sidecar grouping; the `MissingFile` path when `.bin` is left out |
| `draco.glb` / `ktx2.glb` / `meshopt.glb` | Mesh | Compressed glTF via self-hosted decoders |

The OCCT fixtures are generated (so they are licence-free) by [`src/J3D.Occt/scripts/generate-fixtures.mjs`](../../src/J3D.Occt/scripts/generate-fixtures.mjs)
with the full prebuilt libcascade, which has OCCT's writers:

```bash
npm install --no-save libcascade@3.1.0
```

```bash
node src/J3D.Occt/scripts/generate-fixtures.mjs
```

Mesh fixtures will be generated or taken from public-domain sources.
Large-model fixtures (100 MB+) are **generated on demand** (`npm run fixtures:large`), never committed.
