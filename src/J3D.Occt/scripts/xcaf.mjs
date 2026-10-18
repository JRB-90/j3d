// Helpers for writing XCAF documents with the full prebuilt libcascade build, which includes OCCT's
// writers (J3D's own trimmed build only reads). libcascade is deliberately not a project dependency
// (~140 MB), so install it transiently first:
//
//   npm install --no-save libcascade@3.1.0
//
// Shared by generate-fixtures.mjs (the committed fixtures) and plant.mjs (the hierarchical assembly).

/** Loads libcascade, failing with the install command when it isn't there. */
export async function loadOcct() {
  try {
    const { default: oc } = await import('libcascade');
    return helpers(oc);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('These fixtures are written by OCCT: run `npm install --no-save libcascade@3.1.0` first.');
    }
    throw error;
  }
}

function helpers(oc) {
  const progress = () => new oc.Message_ProgressRange();
  const text = (value) => new oc.TCollection_ExtendedString(value, true);
  const rgba = (r, g, b, a = 1) => new oc.Quantity_ColorRGBA(r, g, b, a);
  const surf = oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf;

  const box = (dx, dy, dz) => new oc.BRepPrimAPI_MakeBox(dx, dy, dz).Shape();
  const axis = (x, y, z, dx = 0, dy = 0, dz = 1) => new oc.gp_Ax2(new oc.gp_Pnt(x, y, z), new oc.gp_Dir(dx, dy, dz));
  const cylinder = (radius, height) => new oc.BRepPrimAPI_MakeCylinder(radius, height).Shape();
  const cylinderAt = (x, y, z, radius, height, dx = 0, dy = 0, dz = 1) =>
    new oc.BRepPrimAPI_MakeCylinder(axis(x, y, z, dx, dy, dz), radius, height).Shape();

  /** A shape moved by (x, y, z): for building compounds out of primitives made at the origin. */
  const moved = (shape, x, y, z) => shape.Moved(translation(x, y, z), false);

  /** Several shapes as one compound: one part whose shape holds several solids. */
  function compound(...shapes) {
    const result = new oc.TopoDS_Compound();
    const builder = new oc.BRep_Builder();
    builder.MakeCompound(result);
    shapes.forEach((shape) => builder.Add(result, shape));
    return result;
  }

  function translation(x, y, z) {
    const trsf = new oc.gp_Trsf();
    trsf.SetTranslation(new oc.gp_Vec(x, y, z));
    return new oc.TopLoc_Location(trsf);
  }

  /** A placement: rotations about Z, then Y (degrees, about the origin), then a translation. */
  function placement(x, y, z, aboutZ = 0, aboutY = 0) {
    const trsf = new oc.gp_Trsf();
    trsf.SetTranslation(new oc.gp_Vec(x, y, z));
    const rotate = (dx, dy, dz, degrees) => {
      if (degrees !== 0) {
        const rotation = new oc.gp_Trsf();
        rotation.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(dx, dy, dz)), (degrees * Math.PI) / 180);
        trsf.Multiply(rotation);
      }
    };
    rotate(0, 0, 1, aboutZ);
    rotate(0, 1, 0, aboutY);
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

  /** The document as STEP bytes. */
  function stepBytes(doc, fileName) {
    const writer = new oc.STEPCAFControl_Writer();
    writer.SetColorMode(true);
    writer.SetNameMode(true);
    // Perform = Transfer + Write in single-file mode. (Transfer's "multi" argument switches OCCT to
    // multi-file STEP with external references whenever it is non-null, even when empty.)
    const path = `/tmp/${fileName}`;
    if (!writer.Perform(doc, path, progress())) {
      throw new Error(`STEP export failed for ${fileName}`);
    }
    return readVirtualFile(path);
  }

  function igesBytes(doc, fileName) {
    const writer = new oc.IGESCAFControl_Writer();
    if (!writer.Transfer(doc, progress())) {
      throw new Error(`IGES transfer failed for ${fileName}`);
    }
    const path = `/tmp/${fileName}`;
    writer.Write(path, false);
    return readVirtualFile(path);
  }

  return {
    oc,
    progress,
    text,
    rgba,
    surf,
    box,
    axis,
    cylinder,
    cylinderAt,
    moved,
    compound,
    translation,
    placement,
    newDocument,
    readVirtualFile,
    stepBytes,
    igesBytes,
  };
}
