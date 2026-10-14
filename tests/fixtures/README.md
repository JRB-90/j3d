# Test fixtures

Shared by Vitest (OCCT and mesh tests under Node) and Playwright (browser E2E). Every fixture is generated, so all of them are licence-free.

| Fixture | Format | Exercises |
|---|---|---|
| `box.brep` | BREP | Minimal OCCT round trip, single part, default colour |
| `coloured-part.step` | STEP | Per-face and per-part colours (XCAF); also the template for the large STEP files |
| `assembly.step` | STEP | Nested assembly, names, repeated instances (prototype meshed once) |
| `surfaces.iges` | IGES | IGES reader, colours via IGESCAFControl |
| `invalid.step` | STEP | Corrupt file → `ParseFailed` through a C++ exception (checks WASM exception handling) |
| `translucent.step` | STEP | RGBA colours: an opaque core inside a 40 % opaque cover |
| `part.stl` | Binary STL | STL in the mesh worker, single-node tree |
| `part.obj` | OBJ | OBJ in the mesh worker, object names, default materials |
| `textured/part.obj` + `part.mtl` + `checker.png` | OBJ + MTL | `mtllib` sidecar grouping, MTL texture (`map_Kd`) and opacity (`d 0.4`) |
| `part.glb` | GLB | glTF node hierarchy, `alphaMode: BLEND`, Y-up → Z-up |
| `multi/scene.gltf` + `scene.bin` + `checker.png` | glTF | Multi-file sidecar grouping; `MissingFile` without `scene.bin`; a warning without `checker.png` |
| `draco.glb` / `meshopt.glb` / `ktx2.glb` | GLB | `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu` (ETC1S) via the self-hosted decoders |

All mesh fixtures are the same two-part model (a 40 × 30 × 10 base with a 10 × 10 × 50 post), 24 triangles, with Z-up bounds (−20, −15, 0)–(20, 15, 60). The glTF files store it Y-up, as the spec requires, so they also test the rotation on import.

## Regenerating

OCCT fixtures (BREP/STEP/IGES) need the full prebuilt libcascade, which has OCCT's writers:

```bash
npm install --no-save libcascade@3.1.0
```

```bash
node src/J3D.Occt/scripts/generate-fixtures.mjs
```

Mesh fixtures use gltf-transform, draco3dgltf, meshoptimizer and ktx2-encoder (dev dependencies of `@j3d/viewer`):

```bash
node src/J3D.Viewer/scripts/generate-mesh-fixtures.mjs
```

## Large files (on demand, never committed)

`npm run fixtures:large` writes STEP files of the given sizes in MB (default 200) into the git-ignored `large/` folder. Each repeats `coloured-part.step` as thousands of distinct parts: the worst case for memory. Set `J3D_LARGE_FIXTURES` to the same sizes to run the large-model tests (see docs/plan.md §8):

```bash
npm run fixtures:large -- 200 700
```
