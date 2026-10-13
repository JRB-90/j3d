# Test fixtures

**Status: placeholder — populated in milestones M1–M2** (see [docs/plan.md](../../docs/plan.md#8-testing-strategy)).

Shared by Vitest (OCCT integration tests under Node) and Playwright (browser E2E).

| Fixture | Format | Exercises |
|---|---|---|
| `box.brep` | BREP | Minimal OCCT round trip, single part, default colour |
| `coloured-part.step` | STEP | Per-face and per-part colours (XCAF) |
| `assembly.step` | STEP | Nested assembly, names, repeated instances (prototype meshed once) |
| `surfaces.iges` | IGES | IGES reader, colours via IGESCAFControl |
| `invalid.step` | STEP | Corrupt file → `ParseFailed` error path |
| `part.stl` / `part.obj` / `part.glb` | Mesh | Three.js loader paths, glTF Y-up → Z-up conversion |

Sources: generated with OCCT (so they are licence-free) or public-domain NIST MBE PMI models.
Large-model fixtures (100 MB+) are **generated on demand** (`npm run fixtures:large`), never committed.
