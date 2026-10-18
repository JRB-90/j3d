// Regenerates the OCCT test fixtures in tests/fixtures/ (STEP, IGES, BREP).
//
// Uses the full prebuilt libcascade build, which includes OCCT's writers (see xcaf.mjs); J3D's own
// trimmed build only reads. libcascade is deliberately not a project dependency (~140 MB), so
// install it transiently first:
//
//   npm install --no-save libcascade@3.1.0
//   node src/J3D.Occt/scripts/generate-fixtures.mjs                      # every fixture
//   node src/J3D.Occt/scripts/generate-fixtures.mjs curved-part.step     # just the ones named
//
// The output is committed; rerun only when the fixtures need to change. STEP headers carry a
// timestamp, so regenerating a fixture changes its bytes even when its content is the same.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPlant } from './plant.mjs';
import { loadOcct } from './xcaf.mjs';

const occt = await loadOcct();
const { oc, progress, text, rgba, surf, box, axis, cylinder, cylinderAt, translation, newDocument, readVirtualFile } = occt;

const outDir = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
mkdirSync(outDir, { recursive: true });

function wire(curve) {
  return new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(curve).Edge()).Wire();
}

function loft(...wires) {
  const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  wires.forEach((w) => loft.AddWire(w));
  loft.Build(progress());
  return loft.Shape();
}

function fuse(a, b) {
  return new oc.BRepAlgoAPI_Fuse(a, b, progress()).Shape();
}

function cut(a, b) {
  return new oc.BRepAlgoAPI_Cut(a, b, progress()).Shape();
}

/** Fillets every edge of `shape` for which `select(edge)` holds. */
function fillet(shape, radius, select = () => true) {
  const maker = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const edges = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; edges.More(); edges.Next()) {
    const edge = oc.TopoDS.Edge(edges.Current());
    if (select(edge)) {
      maker.Add(radius, edge);
    }
  }
  maker.Build(progress());
  if (!maker.IsDone()) {
    throw new Error('Fillet failed');
  }
  return maker.Shape();
}

/** An edge's start, middle and end points. */
function pointsOn(edge) {
  const curve = new oc.BRepAdaptor_Curve(edge);
  const [first, last] = [curve.FirstParameter(), curve.LastParameter()];
  return [0, 0.5, 1].map((t) => curve.Value(first + t * (last - first)));
}

function writeStep(doc, fileName) {
  save(fileName, occt.stepBytes(doc, fileName));
}

function writeIges(doc, fileName) {
  save(fileName, occt.igesBytes(doc, fileName));
}

function save(fileName, bytes) {
  writeFileSync(`${outDir}${fileName}`, bytes);
  console.log(`  ${fileName.padEnd(24)} ${bytes.length} bytes`);
}

const only = process.argv.slice(2);
const wanted = (fileName) => only.length === 0 || only.includes(fileName);

console.log(`Writing fixtures to ${outDir}`);

// box.brep — a single 10 x 20 x 30 box: 6 faces, 12 edges, no colour.
if (wanted('box.brep')) {
  const path = '/tmp/box.brep';
  oc.BRepTools.Write(box(10, 20, 30), path, progress());
  save('box.brep', readVirtualFile(path));
}

// coloured-part.step — one part (box) coloured blue, with its top face overridden to red.
if (wanted('coloured-part.step')) {
  const { doc, shapes, colors } = newDocument();
  const shape = box(40, 30, 20);
  const label = shapes.AddShape(shape, false, true);
  oc.TDataStd_Name.Set(label, text('Coloured block'));
  colors.SetColor(label, rgba(0.05, 0.2, 0.8), surf);

  const faces = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let topFace = null;
  for (; faces.More(); faces.Next()) {
    const face = faces.Current();
    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    if (Math.abs(props.CentreOfMass().Z() - 20) < 1e-6) {
      topFace = face;
    }
  }
  const faceLabel = shapes.AddSubShape(label, topFace);
  colors.SetColor(faceLabel, rgba(0.8, 0.05, 0.05), surf);
  writeStep(doc, 'coloured-part.step');
}

// assembly.step — "Bracket assembly" with two instances of the same plate (meshed once) and a pin.
if (wanted('assembly.step')) {
  const { doc, shapes, colors } = newDocument();
  const assembly = shapes.NewShape();
  oc.TDataStd_Name.Set(assembly, text('Bracket assembly'));

  const plate = shapes.AddShape(box(50, 50, 5), false, true);
  oc.TDataStd_Name.Set(plate, text('Plate'));
  colors.SetColor(plate, rgba(0.6, 0.6, 0.62), surf);

  const pin = shapes.AddShape(cylinder(4, 40), false, true);
  oc.TDataStd_Name.Set(pin, text('Pin'));
  colors.SetColor(pin, rgba(0.9, 0.7, 0.1), surf);

  oc.TDataStd_Name.Set(shapes.AddComponent(assembly, plate, translation(0, 0, 0)), text('Plate (bottom)'));
  oc.TDataStd_Name.Set(shapes.AddComponent(assembly, plate, translation(0, 0, 35)), text('Plate (top)'));
  oc.TDataStd_Name.Set(shapes.AddComponent(assembly, pin, translation(25, 25, 0)), text('Pin'));
  shapes.UpdateAssemblies();
  writeStep(doc, 'assembly.step');
}

// translucent.step — an opaque core part inside a 40 % opaque cover.
if (wanted('translucent.step')) {
  const { doc, shapes, colors } = newDocument();
  const assembly = shapes.NewShape();
  oc.TDataStd_Name.Set(assembly, text('Housing'));

  const core = shapes.AddShape(box(10, 10, 10), false, true);
  oc.TDataStd_Name.Set(core, text('Core'));
  colors.SetColor(core, rgba(0.1, 0.6, 0.2), surf);

  const cover = shapes.AddShape(box(30, 30, 30), false, true);
  oc.TDataStd_Name.Set(cover, text('Cover'));
  colors.SetColor(cover, rgba(0.7, 0.8, 0.9, 0.4), surf);

  shapes.AddComponent(assembly, core, translation(10, 10, 10));
  shapes.AddComponent(assembly, cover, translation(0, 0, 0));
  shapes.UpdateAssemblies();
  writeStep(doc, 'translucent.step');
}

// intersecting.step — three 50 % opaque bars crossing at one centre (D134): red along X, green along
// Y, blue along Z. Their centres coincide, so sorting whole objects by distance can't order them.
if (wanted('intersecting.step')) {
  const { doc, shapes, colors } = newDocument();
  const assembly = shapes.NewShape();
  oc.TDataStd_Name.Set(assembly, text('Crossing bars'));
  const bars = [
    ['Red bar', box(40, 10, 10), rgba(0.9, 0.1, 0.1, 0.5), translation(0, 15, 15)],
    ['Green bar', box(10, 40, 10), rgba(0.1, 0.8, 0.1, 0.5), translation(15, 0, 15)],
    ['Blue bar', box(10, 10, 40), rgba(0.1, 0.2, 0.9, 0.5), translation(15, 15, 0)],
  ];
  for (const [name, shape, colour, location] of bars) {
    const bar = shapes.AddShape(shape, false, true);
    oc.TDataStd_Name.Set(bar, text(name));
    colors.SetColor(bar, colour, surf);
    oc.TDataStd_Name.Set(shapes.AddComponent(assembly, bar, location), text(name));
  }
  shapes.UpdateAssemblies();
  writeStep(doc, 'intersecting.step');
}

// surfaces.iges — a green cylinder.
if (wanted('surfaces.iges')) {
  const { doc, shapes, colors } = newDocument();
  const label = shapes.AddShape(cylinder(10, 25), false, true);
  oc.TDataStd_Name.Set(label, text('Cylinder'));
  colors.SetColor(label, rgba(0.1, 0.7, 0.3), surf);
  writeIges(doc, 'surfaces.iges');
}

// curved-part.step — the template for the meshing-heavy large STEP files (D62): a 40 x 30 x 20 block
// with every edge filleted, a lofted boss (a B-spline surface) blended into its top, and six drilled
// holes; 35 faces. Curved faces cost far more to mesh than the planar block of coloured-part.step.
if (wanted('curved-part.step')) {
  const { doc, shapes, colors } = newDocument();
  let shape = fillet(box(40, 30, 20), 2);
  const boss = loft(
    wire(new oc.gp_Circ(axis(20, 15, 19), 7)),
    wire(new oc.gp_Elips(axis(20, 15, 34), 6, 3.5)),
  );
  shape = fuse(shape, boss);
  // The boss meets the top face along a B-spline curve about 7 from the boss's axis.
  shape = fillet(shape, 1.5, (edge) =>
    pointsOn(edge).every((p) => Math.abs(p.Z() - 20) < 1e-4 && Math.abs(Math.hypot(p.X() - 20, p.Y() - 15) - 7) < 0.5),
  );
  for (const [x, y] of [[6, 6], [6, 15], [6, 24], [34, 6], [34, 15], [34, 24]]) {
    shape = cut(shape, cylinderAt(x, y, -1, 2, 22));
  }
  const label = shapes.AddShape(shape, false, true);
  oc.TDataStd_Name.Set(label, text('Curved part'));
  colors.SetColor(label, rgba(0.85, 0.45, 0.1), surf);
  writeStep(doc, 'curved-part.step');
}

// plant.step — a small "plant" (D161): 2 lines of 3 stations, 7 levels deep, assemblies reused as
// instances, compound parts for Expand. Larger ones: npm run fixtures:large -- plant-10000.
if (wanted('plant.step')) {
  save('plant.step', buildPlant(occt, { lines: 2, stations: 3 }));
}

// invalid.step — header only, no data section: must fail with ParseFailed.
if (wanted('invalid.step')) {
  save('invalid.step', new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n'));
}

console.log('Done.');
