// Regenerates the OCCT test fixtures in tests/fixtures/ (STEP, IGES, BREP).
//
// Uses the full prebuilt libcascade build, which includes OCCT's writers; J3D's own trimmed build
// only reads. libcascade is deliberately not a project dependency (~140 MB), so install it
// transiently first:
//
//   npm install --no-save libcascade@3.1.0
//   node src/J3D.Occt/scripts/generate-fixtures.mjs                      # every fixture
//   node src/J3D.Occt/scripts/generate-fixtures.mjs curved-part.step     # just the ones named
//
// The output is committed; rerun only when the fixtures need to change. STEP headers carry a
// timestamp, so regenerating a fixture changes its bytes even when its content is the same.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { default: oc } = await import('libcascade');

const outDir = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const progress = () => new oc.Message_ProgressRange();
const text = (value) => new oc.TCollection_ExtendedString(value, true);
const rgba = (r, g, b, a = 1) => new oc.Quantity_ColorRGBA(r, g, b, a);
const surf = oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf;

function box(dx, dy, dz) {
  return new oc.BRepPrimAPI_MakeBox(dx, dy, dz).Shape();
}

function cylinder(radius, height) {
  return new oc.BRepPrimAPI_MakeCylinder(radius, height).Shape();
}

function cylinderAt(x, y, z, radius, height) {
  return new oc.BRepPrimAPI_MakeCylinder(axis(x, y, z), radius, height).Shape();
}

function axis(x, y, z) {
  return new oc.gp_Ax2(new oc.gp_Pnt(x, y, z), new oc.gp_Dir(0, 0, 1));
}

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

function translation(x, y, z) {
  const trsf = new oc.gp_Trsf();
  trsf.SetTranslation(new oc.gp_Vec(x, y, z));
  return new oc.TopLoc_Location(trsf);
}

function newDocument() {
  // The out-parameter envelope's key differs between libcascade's d.ts ("theDoc") and runtime
  // ("aDoc"), so pick the document out by shape.
  const envelope = oc.XCAFApp_Application.GetApplication().NewDocument(text('MDTV-XCAF'));
  const doc = Object.values(envelope).find((value) => typeof value?.Main === 'function');
  const shapes = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  const colors = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());
  return { doc, shapes, colors };
}

function readVirtualFile(path) {
  const bytes = oc.FS.readFile(path, { encoding: 'binary' });
  oc.FS.unlink(path);
  return bytes;
}

function writeStep(doc, fileName) {
  const writer = new oc.STEPCAFControl_Writer();
  writer.SetColorMode(true);
  writer.SetNameMode(true);
  // Perform = Transfer + Write in single-file mode. (Transfer's "multi" argument switches OCCT to
  // multi-file STEP with external references whenever it is non-null, even when empty.)
  const path = `/tmp/${fileName}`;
  if (!writer.Perform(doc, path, progress())) {
    throw new Error(`STEP export failed for ${fileName}`);
  }
  save(fileName, readVirtualFile(path));
}

function writeIges(doc, fileName) {
  const writer = new oc.IGESCAFControl_Writer();
  if (!writer.Transfer(doc, progress())) {
    throw new Error(`IGES transfer failed for ${fileName}`);
  }
  const path = `/tmp/${fileName}`;
  writer.Write(path, false);
  save(fileName, readVirtualFile(path));
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

// invalid.step — header only, no data section: must fail with ParseFailed.
if (wanted('invalid.step')) {
  save('invalid.step', new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n'));
}

console.log('Done.');
