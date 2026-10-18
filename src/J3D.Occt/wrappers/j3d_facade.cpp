// J3D OCCT facade, compiled into the custom libcascade build (see ../libcascade.config.ts).
//
// Follows Replicad's wrapper pattern: plain C++ classes that the libcascade bindgen exposes to JS
// (scope 'all'), with bulk data returned as malloc'd arrays whose addresses and lengths JS reads
// straight out of WASM memory. One J3DModel lives in one Web Worker and owns one XCAF document.
//
// Pipeline: importFile (STEP/IGES/BREP -> XCAF document) -> mesh (BRepMesh per unique part)
//           -> getSceneJson (assembly tree + instances) + extractPrototype(i) (geometry per part/style).
// Later, on request: measureEntity/measurePair (M7) and exportFile (M9: STEP or BREP of the document).
//
// Addresses are returned as unsigned int: with MAXIMUM_MEMORY=4GB they can exceed INT_MAX.

#include <BRepBndLib.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Circ.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Elips.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>
#include <gp_Trsf.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Message_ProgressIndicator.hxx>
#include <Message_ProgressScope.hxx>
#include <OSD_ThreadPool.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Polygon3D.hxx>
#include <Poly_Triangulation.hxx>
#include <Quantity_ColorRGBA.hxx>
#include <RWMesh_FaceIterator.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <Standard_OutOfMemory.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_List.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFPrs_DocumentExplorer.hxx>
#include <XCAFPrs_Style.hxx>

// The bindgen parses this file without Emscripten's sysroot on the include path; only the real
// compile sees emscripten.h. Progress reporting is compiled in only when it is available.
#if __has_include(<emscripten.h>)
#include <emscripten.h>
#define J3D_HAS_EMSCRIPTEN 1
#else
#define J3D_HAS_EMSCRIPTEN 0
#endif

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <istream>
#include <memory>
#include <new>
#include <sstream>
#include <stdexcept>
#include <streambuf>
#include <string>
#include <unordered_map>
#include <vector>

// ---------------------------------------------------------------------------------------------
// Constants shared with TypeScript (src/J3D.Occt/src/facade.ts)
// ---------------------------------------------------------------------------------------------

namespace j3d {

constexpr int FormatStep = 0;
constexpr int FormatIges = 1;
constexpr int FormatBrep = 2;

constexpr int StatusOk = 0;
constexpr int StatusParseFailed = 1;
constexpr int StatusEmpty = 2;
constexpr int StatusOutOfMemory = 3;
constexpr int StatusInternal = 4;
constexpr int StatusCancelled = 5;

constexpr int PhaseParsing = 1;
constexpr int PhaseTransferring = 2;
constexpr int PhaseMeshing = 3;
constexpr int PhaseExtracting = 4;
constexpr int PhaseWriting = 5;

// Neutral grey for parts without a colour, in linear RGB (#B4B9C0 in sRGB).
inline const Quantity_ColorRGBA DefaultColor(Quantity_Color(0.456, 0.485, 0.527, Quantity_TOC_RGB), 1.0f);

// Reports progress to the worker through `Module.j3dProgress(phase, fraction)` when it is set.
// Throttled to ~10 Hz; fraction < 0 means indeterminate.
inline void reportProgress(int phase, double fraction, bool force = false) {
#if J3D_HAS_EMSCRIPTEN
  // A phase change is always reported; repeats within a phase are throttled.
  static double lastReport = 0.0;
  static int lastPhase = -1;
  const double now = emscripten_get_now();
  if (!force && phase == lastPhase && now - lastReport < 100.0) {
    return;
  }
  lastReport = now;
  lastPhase = phase;
  // clang-format off
  EM_ASM({ if (Module['j3dProgress']) Module['j3dProgress']($0, $1); }, phase, fraction);
  // clang-format on
#else
  (void)phase;
  (void)fraction;
  (void)force;
#endif
}

// Asks the worker through `Module.j3dCancelled()` whether the export in progress should stop (M9,
// D125). The worker reads a shared flag the page sets, since it can't take messages while OCCT runs.
inline bool cancelRequested() {
#if J3D_HAS_EMSCRIPTEN
  // clang-format off
  return EM_ASM_INT({ return Module['j3dCancelled'] && Module['j3dCancelled']() ? 1 : 0; }) != 0;
  // clang-format on
#else
  return false;
#endif
}

inline bool useParallelMeshing() {
#if defined(__EMSCRIPTEN_PTHREADS__)
  const Handle(OSD_ThreadPool)& pool = OSD_ThreadPool::DefaultPool(-1);
  pool->SetNbDefaultThreadsToLaunch(pool->NbThreads());
  return pool->NbThreads() > 1;
#else
  return false;
#endif
}

inline std::string labelName(const TDF_Label& label) {
  Handle(TDataStd_Name) name;
  if (label.IsNull() || !label.FindAttribute(TDataStd_Name::GetID(), name)) {
    return {};
  }
  // ExtendedString -> UTF-8.
  return TCollection_AsciiString(name->Get()).ToCString();
}

inline void appendJsonString(std::string& out, const std::string& value) {
  out += '"';
  for (const unsigned char c : value) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char escaped[8];
          std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
          out += escaped;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  out += '"';
}

inline void appendNumber(std::string& out, double value) {
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.9g", std::isfinite(value) ? value : 0.0);
  out += buffer;
}

// Column-major 4x4 (Three.js Matrix4.fromArray order).
inline void appendMatrix(std::string& out, const gp_Trsf& trsf) {
  out += '[';
  for (int column = 1; column <= 4; ++column) {
    for (int row = 1; row <= 4; ++row) {
      if (column > 1 || row > 1) {
        out += ',';
      }
      appendNumber(out, row == 4 ? (column == 4 ? 1.0 : 0.0) : trsf.Value(row, column));
    }
  }
  out += ']';
}

inline Quantity_ColorRGBA styleColor(const XCAFPrs_Style& style) {
  return style.IsSetColorSurf() ? style.GetColorSurfRGBA() : DefaultColor;
}

inline std::string styleKey(const XCAFPrs_Style& style) {
  if (!style.IsSetColorSurf()) {
    return "-";
  }
  const Quantity_ColorRGBA color = style.GetColorSurfRGBA();
  char buffer[96];
  std::snprintf(buffer, sizeof(buffer), "%.6f,%.6f,%.6f,%.6f", color.GetRGB().Red(), color.GetRGB().Green(),
                color.GetRGB().Blue(), color.Alpha());
  return buffer;
}

template <typename T>
T* allocateArray(std::size_t count) {
  if (count == 0) {
    return nullptr;
  }
  auto* data = static_cast<T*>(std::malloc(count * sizeof(T)));
  if (data == nullptr) {
    throw std::bad_alloc();
  }
  return data;
}

template <typename T>
T* copyToMalloc(const std::vector<T>& values) {
  T* data = allocateArray<T>(values.size());
  if (data != nullptr) {
    std::copy(values.begin(), values.end(), data);
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Measurement helpers (M7)
// ---------------------------------------------------------------------------------------------

constexpr int EntityFace = 0;
constexpr int EntityEdge = 1;
constexpr int EntityVertex = 2;

constexpr double DegreesPerRadian = 57.29577951308232;

inline std::string errorJson(const std::string& message) {
  std::string json = "{\"error\":";
  appendJsonString(json, message);
  return json + '}';
}

inline void appendXyz(std::string& out, const gp_XYZ& xyz) {
  out += '[';
  appendNumber(out, xyz.X());
  out += ',';
  appendNumber(out, xyz.Y());
  out += ',';
  appendNumber(out, xyz.Z());
  out += ']';
}

inline void appendField(std::string& out, const char* name, double value) {
  out += ",\"";
  out += name;
  out += "\":";
  appendNumber(out, value);
}

inline void appendField(std::string& out, const char* name, const gp_XYZ& xyz) {
  out += ",\"";
  out += name;
  out += "\":";
  appendXyz(out, xyz);
}

inline void appendField(std::string& out, const char* name, const char* text) {
  out += ",\"";
  out += name;
  out += "\":\"";
  out += text;
  out += '"';
}

/** 16 comma-separated numbers, column-major (Three.js Matrix4 order), to a rigid OCCT transform. */
inline gp_Trsf parseMatrix(const std::string& text) {
  double m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
  const char* cursor = text.c_str();
  for (int i = 0; i < 16 && *cursor != '\0'; ++i) {
    char* end = nullptr;
    m[i] = std::strtod(cursor, &end);
    if (end == cursor) {
      break;
    }
    cursor = *end == ',' ? end + 1 : end;
  }
  gp_Trsf trsf;
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
  return trsf;
}

inline TopoDS_Shape readShape(const std::string& brep) {
  std::istringstream stream(brep);
  TopoDS_Shape shape;
  BRep_Builder builder;
  BRepTools::Read(shape, stream, builder);
  if (shape.IsNull()) {
    throw std::runtime_error("The other model's shape couldn't be read.");
  }
  return shape;
}

/** A planar face's outward normal, or false. */
inline bool planeNormal(const TopoDS_Shape& shape, gp_Dir& normal) {
  if (shape.ShapeType() != TopAbs_FACE) {
    return false;
  }
  const TopoDS_Face& face = TopoDS::Face(shape);
  BRepAdaptor_Surface surface(face);
  if (surface.GetType() != GeomAbs_Plane) {
    return false;
  }
  normal = surface.Plane().Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) {
    normal.Reverse();
  }
  return true;
}

/** A straight edge's direction, or false. */
inline bool lineDirection(const TopoDS_Shape& shape, gp_Dir& direction) {
  if (shape.ShapeType() != TopAbs_EDGE || BRep_Tool::Degenerated(TopoDS::Edge(shape))) {
    return false;
  }
  BRepAdaptor_Curve curve(TopoDS::Edge(shape));
  if (curve.GetType() != GeomAbs_Line) {
    return false;
  }
  direction = curve.Line().Direction();
  return true;
}

/** A circular edge's centre, or false. */
inline bool circleCentre(const TopoDS_Shape& shape, gp_Pnt& centre) {
  if (shape.ShapeType() != TopAbs_EDGE || BRep_Tool::Degenerated(TopoDS::Edge(shape))) {
    return false;
  }
  BRepAdaptor_Curve curve(TopoDS::Edge(shape));
  if (curve.GetType() != GeomAbs_Circle) {
    return false;
  }
  centre = curve.Circle().Location();
  return true;
}

inline void describeFace(std::string& json, const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  json += "\"kind\":\"face\"";
  appendField(json, "area", props.Mass());
  appendField(json, "anchor", props.CentreOfMass().XYZ());
  BRepAdaptor_Surface surface(face);
  switch (surface.GetType()) {
    case GeomAbs_Plane: {
      gp_Dir normal;
      planeNormal(face, normal);
      appendField(json, "surface", "plane");
      appendField(json, "normal", normal.XYZ());
      break;
    }
    case GeomAbs_Cylinder: {
      const gp_Cylinder cylinder = surface.Cylinder();
      appendField(json, "surface", "cylinder");
      appendField(json, "radius", cylinder.Radius());
      appendField(json, "axis", cylinder.Axis().Direction().XYZ());
      appendField(json, "origin", cylinder.Location().XYZ());
      break;
    }
    case GeomAbs_Cone: {
      const gp_Cone cone = surface.Cone();
      appendField(json, "surface", "cone");
      appendField(json, "semiAngle", cone.SemiAngle() * DegreesPerRadian);
      appendField(json, "axis", cone.Axis().Direction().XYZ());
      appendField(json, "origin", cone.Location().XYZ());
      break;
    }
    case GeomAbs_Sphere: {
      const gp_Sphere sphere = surface.Sphere();
      appendField(json, "surface", "sphere");
      appendField(json, "radius", sphere.Radius());
      appendField(json, "centre", sphere.Location().XYZ());
      break;
    }
    case GeomAbs_Torus: {
      const gp_Torus torus = surface.Torus();
      appendField(json, "surface", "torus");
      appendField(json, "majorRadius", torus.MajorRadius());
      appendField(json, "minorRadius", torus.MinorRadius());
      appendField(json, "axis", torus.Axis().Direction().XYZ());
      appendField(json, "centre", torus.Location().XYZ());
      break;
    }
    default:
      appendField(json, "surface", "other");
      break;
  }
}

inline void describeEdge(std::string& json, const TopoDS_Edge& edge) {
  GProp_GProps props;
  BRepGProp::LinearProperties(edge, props);
  json += "\"kind\":\"edge\"";
  appendField(json, "length", props.Mass());
  TopoDS_Vertex first;
  TopoDS_Vertex last;
  TopExp::Vertices(edge, first, last);
  if (!first.IsNull()) {
    appendField(json, "start", BRep_Tool::Pnt(first).XYZ());
  }
  if (!last.IsNull()) {
    appendField(json, "end", BRep_Tool::Pnt(last).XYZ());
  }
  BRepAdaptor_Curve curve(edge);
  appendField(json, "anchor", curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2).XYZ());
  switch (curve.GetType()) {
    case GeomAbs_Line:
      appendField(json, "curve", "line");
      appendField(json, "direction", curve.Line().Direction().XYZ());
      break;
    case GeomAbs_Circle: {
      const gp_Circ circle = curve.Circle();
      appendField(json, "curve", "circle");
      appendField(json, "radius", circle.Radius());
      appendField(json, "centre", circle.Location().XYZ());
      appendField(json, "normal", circle.Axis().Direction().XYZ());
      break;
    }
    case GeomAbs_Ellipse: {
      const gp_Elips ellipse = curve.Ellipse();
      appendField(json, "curve", "ellipse");
      appendField(json, "majorRadius", ellipse.MajorRadius());
      appendField(json, "minorRadius", ellipse.MinorRadius());
      appendField(json, "centre", ellipse.Location().XYZ());
      break;
    }
    default:
      appendField(json, "curve", "other");
      break;
  }
}

inline void describeEntity(std::string& json, const TopoDS_Shape& entity) {
  switch (entity.ShapeType()) {
    case TopAbs_FACE:
      describeFace(json, TopoDS::Face(entity));
      break;
    case TopAbs_EDGE:
      describeEdge(json, TopoDS::Edge(entity));
      break;
    case TopAbs_VERTEX: {
      const gp_XYZ point = BRep_Tool::Pnt(TopoDS::Vertex(entity)).XYZ();
      json += "\"kind\":\"vertex\"";
      appendField(json, "point", point);
      appendField(json, "anchor", point);
      break;
    }
    default:
      json += "\"kind\":\"other\"";
      break;
  }
}

/** A part's volume (0 for open shells), surface area, centre of mass and world bounds. */
inline void describePart(std::string& json, const TopoDS_Shape& part) {
  GProp_GProps volume;
  BRepGProp::VolumeProperties(part, volume);
  GProp_GProps surface;
  BRepGProp::SurfaceProperties(part, surface);
  Bnd_Box box;
  BRepBndLib::AddOptimal(part, box, false, false);
  const double mass = std::abs(volume.Mass());
  json += "{\"volume\":";
  appendNumber(json, mass);
  appendField(json, "area", surface.Mass());
  appendField(json, "centroid", (mass > 0 ? volume : surface).CentreOfMass().XYZ());
  if (!box.IsVoid()) {
    appendField(json, "min", box.CornerMin().XYZ());
    appendField(json, "max", box.CornerMax().XYZ());
  }
  json += '}';
}

/** Degrees between two directions, folded to 0-90: planes and lines have no sense of direction. */
inline double acuteAngle(const gp_Dir& a, const gp_Dir& b) {
  return std::acos(std::min(1.0, std::abs(a.Dot(b)))) * DegreesPerRadian;
}

inline std::string describePair(const TopoDS_Shape& a, const TopoDS_Shape& b) {
  std::string json = "{\"kind\":\"pair\"";
  BRepExtrema_DistShapeShape distance(a, b);
  if (distance.IsDone() && distance.NbSolution() > 0) {
    appendField(json, "distance", distance.Value());
    appendField(json, "pointA", distance.PointOnShape1(1).XYZ());
    appendField(json, "pointB", distance.PointOnShape2(1).XYZ());
  }

  gp_Dir normalA;
  gp_Dir normalB;
  gp_Dir lineA;
  gp_Dir lineB;
  const bool planeA = planeNormal(a, normalA);
  const bool planeB = planeNormal(b, normalB);
  const bool straightA = lineDirection(a, lineA);
  const bool straightB = lineDirection(b, lineB);
  if (planeA && planeB) {
    appendField(json, "angleOf", "planes");
    appendField(json, "angle", acuteAngle(normalA, normalB));
  } else if (straightA && straightB) {
    appendField(json, "angleOf", "lines");
    appendField(json, "angle", acuteAngle(lineA, lineB));
  } else if ((straightA && planeB) || (planeA && straightB)) {
    appendField(json, "angleOf", "line and plane");
    appendField(json, "angle", 90.0 - acuteAngle(straightA ? lineA : lineB, planeA ? normalA : normalB));
  }

  gp_Pnt centreA;
  gp_Pnt centreB;
  if (circleCentre(a, centreA) && circleCentre(b, centreB)) {
    appendField(json, "centreDistance", centreA.Distance(centreB));
    appendField(json, "centreA", centreA.XYZ());
    appendField(json, "centreB", centreB.XYZ());
  }
  return json + '}';
}

}  // namespace j3d

// ---------------------------------------------------------------------------------------------
// J3DMeshData: geometry of one prototype (a unique part + style), in the part's own coordinates.
// ---------------------------------------------------------------------------------------------

class J3DModel;

class J3DMeshData {
public:
  J3DMeshData() = default;

  ~J3DMeshData() {
    std::free(positions_);
    std::free(normals_);
    std::free(indices_);
    std::free(colors_);
    std::free(edges_);
    std::free(faceRanges_);
    std::free(edgeRanges_);
    std::free(vertices_);
  }

  // Embind copies return values; like Replicad's mesh data, a copy takes ownership of the buffers.
  J3DMeshData(const J3DMeshData& other)
      : positions_(other.positions_), normals_(other.normals_), indices_(other.indices_),
        colors_(other.colors_), edges_(other.edges_), faceRanges_(other.faceRanges_), edgeRanges_(other.edgeRanges_),
        vertices_(other.vertices_), positionCount_(other.positionCount_),
        indexCount_(other.indexCount_), opaqueIndexCount_(other.opaqueIndexCount_),
        colorCount_(other.colorCount_), edgeCount_(other.edgeCount_), faceRangeCount_(other.faceRangeCount_),
        edgeRangeCount_(other.edgeRangeCount_), vertexCount_(other.vertexCount_),
        uniform_{other.uniform_[0], other.uniform_[1], other.uniform_[2], other.uniform_[3]} {
    auto& source = const_cast<J3DMeshData&>(other);
    source.positions_ = nullptr;
    source.normals_ = nullptr;
    source.indices_ = nullptr;
    source.colors_ = nullptr;
    source.edges_ = nullptr;
    source.faceRanges_ = nullptr;
    source.edgeRanges_ = nullptr;
    source.vertices_ = nullptr;
  }

  J3DMeshData& operator=(const J3DMeshData&) = delete;

  /** float32 xyz per vertex. */
  unsigned int getPositionsPtr() const { return address(positions_); }
  int getPositionsLength() const { return positionCount_; }
  /** float32 xyz per vertex (same length as positions). */
  unsigned int getNormalsPtr() const { return address(normals_); }
  /** uint32 triangle indices: opaque triangles first, then translucent ones. */
  unsigned int getIndicesPtr() const { return address(indices_); }
  int getIndicesLength() const { return indexCount_; }
  int getOpaqueIndexCount() const { return opaqueIndexCount_; }
  /** float32 linear RGBA per vertex, or 0/length 0 when the whole prototype has one colour. */
  unsigned int getColorsPtr() const { return address(colors_); }
  int getColorsLength() const { return colorCount_; }
  /** Linear RGBA of a single-colour prototype (channel 0-3). */
  double getUniformColor(int channel) const { return channel >= 0 && channel < 4 ? uniform_[channel] : 0.0; }
  /** float32 xyz pairs: one line segment per two points. */
  unsigned int getEdgesPtr() const { return address(edges_); }
  int getEdgesLength() const { return edgeCount_; }
  /**
   * uint32 (first index, index count) per BREP face, in face order: which part of the index array
   * draws face i (M7). A face's triangles are contiguous, in the opaque or the translucent range.
   */
  unsigned int getFaceRangesPtr() const { return address(faceRanges_); }
  int getFaceRangesLength() const { return faceRangeCount_; }
  /** uint32 (first edge point, point count) per BREP edge, in edge order: its segments in the edge array. */
  unsigned int getEdgeRangesPtr() const { return address(edgeRanges_); }
  int getEdgeRangesLength() const { return edgeRangeCount_; }
  /** float32 xyz per BREP vertex, in vertex order. */
  unsigned int getVerticesPtr() const { return address(vertices_); }
  int getVerticesLength() const { return vertexCount_; }

private:
  static unsigned int address(const void* data) {
    return static_cast<unsigned int>(reinterpret_cast<std::uintptr_t>(data));
  }

  float* positions_ = nullptr;
  float* normals_ = nullptr;
  uint32_t* indices_ = nullptr;
  float* colors_ = nullptr;
  float* edges_ = nullptr;
  uint32_t* faceRanges_ = nullptr;
  uint32_t* edgeRanges_ = nullptr;
  float* vertices_ = nullptr;
  int positionCount_ = 0;
  int indexCount_ = 0;
  int opaqueIndexCount_ = 0;
  int colorCount_ = 0;
  int edgeCount_ = 0;
  int faceRangeCount_ = 0;
  int edgeRangeCount_ = 0;
  int vertexCount_ = 0;
  double uniform_[4] = {0.0, 0.0, 0.0, 1.0};

  friend class J3DModel;
};

// ---------------------------------------------------------------------------------------------
// J3DModel: one imported file, held in an XCAF document for the lifetime of its worker.
// ---------------------------------------------------------------------------------------------

class J3DModel {
public:
  J3DModel() = default;

  ~J3DModel() { releaseInput(); }

  /** Allocates the input buffer JS streams the file into. Returns its address, or 0 on failure. */
  unsigned int allocateInput(unsigned int byteLength) {
    releaseInput();
    input_ = static_cast<char*>(std::malloc(byteLength == 0 ? 1 : byteLength));
    inputLength_ = input_ == nullptr ? 0 : byteLength;
    return static_cast<unsigned int>(reinterpret_cast<std::uintptr_t>(input_));
  }

  void releaseInput() {
    std::free(input_);
    input_ = nullptr;
    inputLength_ = 0;
  }

  /** Imports the input buffer. format: 0 STEP, 1 IGES, 2 BREP. Returns a status code. */
  int importFile(int format, const std::string& fileName) {
    return guarded([&] {
      if (input_ == nullptr) {
        return fail(j3d::StatusInternal, "No input buffer allocated.");
      }

      j3d::reportProgress(j3d::PhaseParsing, -1.0, true);
      createDocument();

      int status = j3d::StatusInternal;
      switch (format) {
        case j3d::FormatStep: status = importStep(fileName); break;
        case j3d::FormatIges: status = importIges(fileName); break;
        case j3d::FormatBrep: status = importBrep(fileName); break;
        default: return fail(j3d::StatusInternal, "Unknown format.");
      }
      releaseInput();
      if (status != j3d::StatusOk) {
        return status;
      }

      TDF_LabelSequence roots;
      shapeTool_->GetFreeShapes(roots);
      if (roots.IsEmpty()) {
        return fail(j3d::StatusEmpty, "The file contains no shapes.");
      }
      return j3d::StatusOk;
    });
  }

  /**
   * Tessellates every unique part once. linearDeflectionRatio is relative to the model's bounding
   * box diagonal (e.g. 0.001); angularDeflection is in radians.
   */
  int mesh(double linearDeflectionRatio, double angularDeflection) {
    return guarded([&] {
      buildScene();
      if (prototypes_.empty()) {
        return fail(j3d::StatusEmpty, "The file contains no visible geometry.");
      }

      Bnd_Box bounds;
      for (const Prototype& prototype : prototypes_) {
        BRepBndLib::Add(prototype.shape, bounds);
      }
      const double diagonal = bounds.IsVoid() ? 1.0 : std::sqrt(bounds.SquareExtent());
      const double linearDeflection = std::max(diagonal * linearDeflectionRatio, 1.0e-6);
      const bool parallel = j3d::useParallelMeshing();

      // Prototypes that differ only by style share a shape, and BRepMesh skips shapes that already
      // carry a fine-enough triangulation, so each unique shape is meshed once.
      for (std::size_t i = 0; i < prototypes_.size(); ++i) {
        j3d::reportProgress(j3d::PhaseMeshing, static_cast<double>(i) / prototypes_.size());
        BRepMesh_IncrementalMesh(prototypes_[i].shape, linearDeflection, false, angularDeflection, parallel);
      }
      linearDeflection_ = linearDeflection;
      angularDeflection_ = angularDeflection;
      topology_.assign(prototypes_.size(), Topology());
      j3d::reportProgress(j3d::PhaseMeshing, 1.0, true);
      return j3d::StatusOk;
    });
  }

  int getPrototypeCount() const { return static_cast<int>(prototypes_.size()); }

  /** Faces (with colours) and BREP edges of prototype `index`. Call after mesh(). */
  J3DMeshData extractPrototype(int index) const {
    J3DMeshData data;
    if (index < 0 || index >= static_cast<int>(prototypes_.size())) {
      return data;
    }
    j3d::reportProgress(j3d::PhaseExtracting, static_cast<double>(index) / prototypes_.size());
    const Prototype& prototype = prototypes_[index];
    if (topology_.size() < prototypes_.size()) {
      topology_.resize(prototypes_.size());
    }
    Topology& topology = topology_[index];
    topology = Topology();
    extractFaces(prototype, data, topology);
    extractEdges(prototype, data, topology);
    extractVertices(prototype, data, topology);
    return data;
  }

  /**
   * JSON: { nodes: [{ name, parent, prototype }], instances: [{ node, prototype, matrix }] }.
   * prototype is -1 for assemblies; matrix is the instance's world transform (column-major 4x4).
   */
  std::string getSceneJson() const { return sceneJson_; }

  /** Message for the last non-OK status. */
  std::string getLastError() const { return lastError_; }

  // -------------------------------------------------------------------------------------------
  // Measurement (M7, decisions D80, D102, D104). An entity is (kind, prototype, index), kind 0 face,
  // 1 edge, 2 vertex, numbered as in the prototype's mesh data; `matrix` is the placement's world
  // transform as 16 comma-separated numbers, column-major. Results are JSON in world coordinates
  // (the model's length unit, millimetres for STEP and IGES), or {"error": "..."}.
  // -------------------------------------------------------------------------------------------

  /** One entity's properties, and its whole part's ("part": volume, area, centroid, bounds). */
  std::string measureEntity(int kind, int prototype, int index, const std::string& matrix) const {
    return measured([&] {
      const gp_Trsf placement = j3d::parseMatrix(matrix);
      const TopoDS_Shape entity = entityShape(kind, prototype, index).Moved(TopLoc_Location(placement));
      std::string json = "{";
      j3d::describeEntity(json, entity);
      json += ",\"part\":";
      j3d::describePart(json, prototypes_[prototype].shape.Moved(TopLoc_Location(placement)));
      json += '}';
      return json;
    });
  }

  /**
   * Two entities: the minimum distance and its closest points, the angle between planes or lines,
   * and the distance between circle centres. When `shapeB` holds BREP text (exportEntity in another
   * model's worker, D102), it is entity B instead of (kindB, prototypeB, indexB) here.
   */
  std::string measurePair(int kindA, int prototypeA, int indexA, const std::string& matrixA, int kindB, int prototypeB,
                          int indexB, const std::string& matrixB, const std::string& shapeB) const {
    return measured([&] {
      const TopoDS_Shape a = entityShape(kindA, prototypeA, indexA).Moved(TopLoc_Location(j3d::parseMatrix(matrixA)));
      TopoDS_Shape b = shapeB.empty() ? entityShape(kindB, prototypeB, indexB) : j3d::readShape(shapeB);
      b = b.Moved(TopLoc_Location(j3d::parseMatrix(matrixB)));
      return j3d::describePair(a, b);
    });
  }

  /** An entity as BREP text, in its part's own coordinates, for a pair across models (D102). */
  std::string exportEntity(int kind, int prototype, int index) const {
    return measured([&] {
      std::ostringstream stream;
      BRepTools::Write(entityShape(kind, prototype, index), stream);
      return stream.str();
    });
  }

  // -------------------------------------------------------------------------------------------
  // Export (M9, decisions D83, D125, D126). The whole model as imported, written into an output
  // buffer of 16 MB chunks that JS copies out and then releases, so a large file is never held twice
  // in the WASM heap. `Module.j3dCancelled()` is polled while OCCT works, to stop an export.
  // -------------------------------------------------------------------------------------------

  /**
   * Writes the model: format 0 STEP (AP214, OCCT's default, with the assembly, names and colours),
   * 2 BREP (the free shapes at their locations, without J3D's triangulation). Returns a status code,
   * StatusCancelled when asked to stop; the output then stays empty.
   */
  int exportFile(int format) {
    releaseOutput();
    const int status = guarded(
        [&] {
          if (document_.IsNull()) {
            return fail(j3d::StatusInternal, "No model to export.");
          }
          switch (format) {
            case j3d::FormatStep: return exportStep();
            case j3d::FormatBrep: return exportBrep();
            default: return fail(j3d::StatusInternal, "Unknown export format.");
          }
        },
        "OCCT reported an error while writing the file.");
    if (status != j3d::StatusOk) {
      releaseOutput();
    }
    return status;
  }

  /** Bytes written by the last export. */
  unsigned int getOutputLength() const { return static_cast<unsigned int>(output_->length()); }
  int getOutputChunkCount() const { return output_->chunkCount(); }
  unsigned int getOutputChunkPtr(int index) const {
    return static_cast<unsigned int>(reinterpret_cast<std::uintptr_t>(output_->chunk(index)));
  }
  int getOutputChunkLength(int index) const { return static_cast<int>(output_->chunkLength(index)); }

  void releaseOutput() { output_->clear(); }

private:
  // Helpers are private nested classes on purpose: the libcascade bindgen binds every top-level
  // (and single-namespace) class in this file, but skips private nested types.
  // OCCT progress indicator that forwards transfer progress to reportProgress. A cancellable one
  // (export) breaks off OCCT's work once the worker asks it to; the answer is kept.
  class ProgressIndicator : public Message_ProgressIndicator {
  public:
    explicit ProgressIndicator(int phase, bool cancellable = false) : phase_(phase), cancellable_(cancellable) {}

    bool UserBreak() override {
      cancelled_ = cancelled_ || (cancellable_ && j3d::cancelRequested());
      return cancelled_;
    }

  protected:
    void Show(const Message_ProgressScope&, const bool isForce) override {
      j3d::reportProgress(phase_, GetPosition(), isForce);
    }

  private:
    int phase_;
    bool cancellable_;
    bool cancelled_ = false;
  };

  // Write-only std::streambuf over a list of malloc'd chunks: growing it never copies what's been
  // written, and running out of memory shows as failed() rather than an exception inside the stream.
  class OutputBuffer : public std::streambuf {
  public:
    OutputBuffer() = default;
    OutputBuffer(const OutputBuffer&) = delete;
    OutputBuffer& operator=(const OutputBuffer&) = delete;
    ~OutputBuffer() override { clear(); }

    void clear() {
      for (char* chunk : chunks_) {
        std::free(chunk);
      }
      chunks_.clear();
      setp(nullptr, nullptr);
      failed_ = false;
    }

    bool failed() const { return failed_; }
    int chunkCount() const { return static_cast<int>(chunks_.size()); }
    const char* chunk(int index) const {
      return index >= 0 && index < chunkCount() ? chunks_[static_cast<std::size_t>(index)] : nullptr;
    }
    std::size_t chunkLength(int index) const {
      if (index < 0 || index >= chunkCount()) {
        return 0;
      }
      return index + 1 < chunkCount() ? ChunkSize : static_cast<std::size_t>(pptr() - pbase());
    }
    std::size_t length() const {
      return chunks_.empty() ? 0 : (chunks_.size() - 1) * ChunkSize + static_cast<std::size_t>(pptr() - pbase());
    }

  protected:
    int_type overflow(int_type c) override {
      if (traits_type::eq_int_type(c, traits_type::eof())) {
        return traits_type::not_eof(c);
      }
      if (pptr() == epptr() && !nextChunk()) {
        return traits_type::eof();
      }
      *pptr() = traits_type::to_char_type(c);
      pbump(1);
      return c;
    }

    std::streamsize xsputn(const char* text, std::streamsize count) override {
      std::streamsize written = 0;
      while (written < count) {
        if (pptr() == epptr() && !nextChunk()) {
          break;
        }
        const std::streamsize part = std::min<std::streamsize>(count - written, epptr() - pptr());
        std::memcpy(pptr(), text + written, static_cast<std::size_t>(part));
        pbump(static_cast<int>(part));  // at most one chunk
        written += part;
      }
      return written;
    }

  private:
    static constexpr std::size_t ChunkSize = std::size_t{16} << 20;

    bool nextChunk() {
      char* chunk = static_cast<char*>(std::malloc(ChunkSize));
      if (chunk == nullptr) {
        failed_ = true;
        return false;
      }
      try {
        chunks_.push_back(chunk);
      } catch (...) {
        std::free(chunk);
        failed_ = true;
        return false;
      }
      setp(chunk, chunk + ChunkSize);
      return true;
    }

    std::vector<char*> chunks_;
    bool failed_ = false;
  };

  // Read-only, seekable std::streambuf over an existing buffer (zero copy).
  class MemoryStreamBuffer : public std::streambuf {
  public:
    MemoryStreamBuffer(char* data, std::size_t size) { setg(data, data, data + size); }

  protected:
    pos_type seekoff(off_type offset, std::ios_base::seekdir direction, std::ios_base::openmode) override {
      char* target = direction == std::ios_base::beg   ? eback() + offset
                     : direction == std::ios_base::cur ? gptr() + offset
                                                       : egptr() + offset;
      if (target < eback() || target > egptr()) {
        return pos_type(off_type(-1));
      }
      setg(eback(), target, egptr());
      return pos_type(target - eback());
    }

    pos_type seekpos(pos_type position, std::ios_base::openmode mode) override {
      return seekoff(off_type(position), std::ios_base::beg, mode);
    }
  };

  struct Prototype {
    TDF_Label label;
    TopoDS_Shape shape;
    XCAFPrs_Style style;
  };

  // A prototype's BREP faces, edges and vertices in the order its mesh data numbers them (M7), so a
  // query can name one by (prototype, index). Filled by extractPrototype.
  struct Topology {
    std::vector<TopoDS_Face> faces;
    std::vector<TopoDS_Edge> edges;
    std::vector<TopoDS_Vertex> vertices;
  };

  // Runs a query, turning OCCT and range failures into {"error": "..."}.
  template <typename Body>
  std::string measured(Body&& body) const {
    try {
      return body();
    } catch (const Standard_Failure& failure) {
      const char* message = failure.what();
      return j3d::errorJson(message != nullptr && *message != '\0' ? message : "OCCT couldn't measure that.");
    } catch (const std::exception& exception) {
      return j3d::errorJson(exception.what());
    } catch (...) {
      return j3d::errorJson("Unknown error.");
    }
  }

  const TopoDS_Shape& entityShape(int kind, int prototype, int index) const {
    if (prototype < 0 || prototype >= static_cast<int>(topology_.size())) {
      throw std::out_of_range("No such part.");
    }
    const Topology& topology = topology_[prototype];
    switch (kind) {
      case j3d::EntityFace:
        if (index >= 0 && index < static_cast<int>(topology.faces.size())) return topology.faces[index];
        break;
      case j3d::EntityEdge:
        if (index >= 0 && index < static_cast<int>(topology.edges.size())) return topology.edges[index];
        break;
      case j3d::EntityVertex:
        if (index >= 0 && index < static_cast<int>(topology.vertices.size())) return topology.vertices[index];
        break;
      default:
        break;
    }
    throw std::out_of_range("No such face, edge or vertex.");
  }

  template <typename Body>
  int guarded(Body&& body, const char* failureMessage = "OCCT reported an error while reading the file.") {
    try {
      lastError_.clear();
      return body();
    } catch (const Standard_OutOfMemory&) {
      return fail(j3d::StatusOutOfMemory, "Out of memory.");
    } catch (const std::bad_alloc&) {
      return fail(j3d::StatusOutOfMemory, "Out of memory.");
    } catch (const Standard_Failure& failure) {
      const char* message = failure.what();
      return fail(j3d::StatusParseFailed, message != nullptr && *message != '\0' ? message : failureMessage);
    } catch (const std::exception& exception) {
      return fail(j3d::StatusInternal, exception.what());
    } catch (...) {
      return fail(j3d::StatusInternal, "Unknown error.");
    }
  }

  int fail(int status, const std::string& message) {
    lastError_ = message;
    return status;
  }

  void createDocument() {
    Handle(XCAFApp_Application) application = XCAFApp_Application::GetApplication();
    application->NewDocument(TCollection_ExtendedString("MDTV-XCAF"), document_);
    shapeTool_ = XCAFDoc_DocumentTool::ShapeTool(document_->Main());
  }

  int importStep(const std::string& fileName) {
    MemoryStreamBuffer buffer(input_, inputLength_);
    std::istream stream(&buffer);

    STEPCAFControl_Reader reader;
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    reader.SetLayerMode(false);
    reader.SetPropsMode(false);
    if (reader.ReadStream(fileName.c_str(), stream) != IFSelect_RetDone) {
      return fail(j3d::StatusParseFailed, "Not a readable STEP file.");
    }

    Handle(ProgressIndicator) progress = new ProgressIndicator(j3d::PhaseTransferring);
    if (!reader.Transfer(document_, progress->Start())) {
      return fail(j3d::StatusParseFailed, "The STEP file could not be translated.");
    }
    return j3d::StatusOk;
  }

  int importIges(const std::string&) {
    // IGES has no stream reader, so the buffer goes through Emscripten's in-memory filesystem.
    const char* path = "/tmp/j3d-input.igs";
    if (FILE* file = std::fopen(path, "wb")) {
      const bool written = std::fwrite(input_, 1, inputLength_, file) == inputLength_;
      std::fclose(file);
      if (!written) {
        std::remove(path);
        return fail(j3d::StatusOutOfMemory, "Out of memory while staging the IGES file.");
      }
    } else {
      return fail(j3d::StatusInternal, "Could not stage the IGES file.");
    }
    releaseInput();

    IGESCAFControl_Reader reader;
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    reader.SetLayerMode(false);
    const IFSelect_ReturnStatus status = reader.ReadFile(path);
    std::remove(path);
    if (status != IFSelect_RetDone) {
      return fail(j3d::StatusParseFailed, "Not a readable IGES file.");
    }

    Handle(ProgressIndicator) progress = new ProgressIndicator(j3d::PhaseTransferring);
    if (!reader.Transfer(document_, progress->Start())) {
      return fail(j3d::StatusParseFailed, "The IGES file could not be translated.");
    }
    return j3d::StatusOk;
  }

  int importBrep(const std::string& fileName) {
    MemoryStreamBuffer buffer(input_, inputLength_);
    std::istream stream(&buffer);

    TopoDS_Shape shape;
    BRep_Builder builder;
    Handle(ProgressIndicator) progress = new ProgressIndicator(j3d::PhaseTransferring);
    BRepTools::Read(shape, stream, builder, progress->Start());
    if (shape.IsNull()) {
      return fail(j3d::StatusParseFailed, "Not a readable BREP file.");
    }

    const TDF_Label label = shapeTool_->AddShape(shape, false);
    TDataStd_Name::Set(label, TCollection_ExtendedString(fileName.c_str(), true));
    return j3d::StatusOk;
  }

  int exportStep() {
    j3d::reportProgress(j3d::PhaseTransferring, 0.0, true);
    STEPCAFControl_Writer writer;
    writer.SetColorMode(true);
    writer.SetNameMode(true);
    writer.SetLayerMode(false);
    writer.SetPropsMode(false);

    Handle(ProgressIndicator) progress = new ProgressIndicator(j3d::PhaseTransferring, true);
    const bool transferred = writer.Transfer(document_, STEPControl_AsIs, nullptr, progress->Start());
    if (progress->UserBreak()) {
      return fail(j3d::StatusCancelled, "Export cancelled.");
    }
    if (!transferred) {
      return fail(j3d::StatusParseFailed, "The model couldn't be translated to STEP.");
    }

    // OCCT's STEP writer reports no progress of its own.
    j3d::reportProgress(j3d::PhaseWriting, -1.0, true);
    std::ostream stream(output_.get());
    const IFSelect_ReturnStatus written = writer.WriteStream(stream);
    if (output_->failed()) {
      return fail(j3d::StatusOutOfMemory, "Out of memory while writing the file.");
    }
    if (written != IFSelect_RetDone || !stream) {
      return fail(j3d::StatusParseFailed, "The STEP file couldn't be written.");
    }
    j3d::reportProgress(j3d::PhaseWriting, 1.0, true);
    return j3d::StatusOk;
  }

  int exportBrep() {
    TDF_LabelSequence roots;
    shapeTool_->GetFreeShapes(roots);
    TopoDS_Shape shape;
    if (roots.Length() == 1) {
      shape = XCAFDoc_ShapeTool::GetShape(roots.First());
    } else {
      TopoDS_Compound compound;
      BRep_Builder builder;
      builder.MakeCompound(compound);
      for (int i = 1; i <= roots.Length(); ++i) {
        const TopoDS_Shape root = XCAFDoc_ShapeTool::GetShape(roots.Value(i));
        if (!root.IsNull()) {
          builder.Add(compound, root);
        }
      }
      shape = compound;
    }
    if (shape.IsNull()) {
      return fail(j3d::StatusEmpty, "The model contains no shapes.");
    }

    j3d::reportProgress(j3d::PhaseWriting, 0.0, true);
    Handle(ProgressIndicator) progress = new ProgressIndicator(j3d::PhaseWriting, true);
    std::ostream stream(output_.get());
    BRepTools::Write(shape, stream, false, false, TopTools_FormatVersion_CURRENT, progress->Start());
    if (progress->UserBreak()) {
      return fail(j3d::StatusCancelled, "Export cancelled.");
    }
    if (output_->failed()) {
      return fail(j3d::StatusOutOfMemory, "Out of memory while writing the file.");
    }
    if (!stream) {
      return fail(j3d::StatusParseFailed, "The BREP file couldn't be written.");
    }
    j3d::reportProgress(j3d::PhaseWriting, 1.0, true);
    return j3d::StatusOk;
  }

  // Walks the XCAF document into the flat scene tree and the list of unique (part, style) prototypes.
  void buildScene() {
    prototypes_.clear();
    std::unordered_map<std::string, int> prototypeByKey;
    std::vector<int> parentAtDepth;
    std::string nodes = "[";
    std::string instances = "[";
    int nodeCount = 0;
    int instanceCount = 0;

    for (XCAFPrs_DocumentExplorer explorer(document_, XCAFPrs_DocumentExplorerFlags_None); explorer.More();
         explorer.Next()) {
      const XCAFPrs_DocumentNode& node = explorer.Current();
      const int depth = explorer.CurrentDepth();
      const int parent = depth > 0 && depth - 1 < static_cast<int>(parentAtDepth.size()) ? parentAtDepth[depth - 1] : -1;

      std::string name = j3d::labelName(node.Label);
      if (name.empty()) {
        name = j3d::labelName(node.RefLabel);
      }

      int prototypeIndex = -1;
      if (!node.IsAssembly && node.Style.IsVisible()) {
        TCollection_AsciiString entry;
        TDF_Tool::Entry(node.RefLabel, entry);
        const std::string key = std::string(entry.ToCString()) + "|" + j3d::styleKey(node.Style);
        const auto found = prototypeByKey.find(key);
        if (found != prototypeByKey.end()) {
          prototypeIndex = found->second;
        } else {
          const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(node.RefLabel);
          if (!shape.IsNull()) {
            prototypeIndex = static_cast<int>(prototypes_.size());
            prototypes_.push_back({node.RefLabel, shape, node.Style});
            prototypeByKey.emplace(key, prototypeIndex);
          }
        }

        if (prototypeIndex >= 0) {
          if (instanceCount++ > 0) {
            instances += ',';
          }
          instances += "{\"node\":" + std::to_string(nodeCount) + ",\"prototype\":" + std::to_string(prototypeIndex) +
                       ",\"matrix\":";
          j3d::appendMatrix(instances, node.Location.Transformation());
          instances += '}';
        }
      }

      if (nodeCount > 0) {
        nodes += ',';
      }
      nodes += "{\"name\":";
      j3d::appendJsonString(nodes, name);
      nodes += ",\"parent\":" + std::to_string(parent) + ",\"prototype\":" + std::to_string(prototypeIndex) + '}';

      parentAtDepth.resize(depth + 1);
      parentAtDepth[depth] = nodeCount;
      ++nodeCount;
    }

    sceneJson_ = "{\"nodes\":" + nodes + "],\"instances\":" + instances + "]}";
  }

  void extractFaces(const Prototype& prototype, J3DMeshData& data, Topology& topology) const {
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> colors;
    std::vector<uint32_t> opaque;
    std::vector<uint32_t> translucent;
    bool uniform = true;
    Quantity_ColorRGBA first;
    bool haveFirst = false;
    // Per face: translucent?, first index within its range, index count.
    std::vector<uint32_t> ranges;

    const Quantity_ColorRGBA fallback = j3d::styleColor(prototype.style);
    for (RWMesh_FaceIterator face(prototype.label, TopLoc_Location(), true, prototype.style); face.More();
         face.Next()) {
      if (face.IsEmptyMesh()) {
        continue;
      }

      const Quantity_ColorRGBA color = face.HasFaceColor() ? face.FaceColor() : fallback;
      if (!haveFirst) {
        first = color;
        haveFirst = true;
      } else if (!(color == first)) {
        uniform = false;
      }

      const uint32_t base = static_cast<uint32_t>(positions.size() / 3);
      for (int node = face.NodeLower(); node <= face.NodeUpper(); ++node) {
        const gp_XYZ point = face.NodeTransformed(node).XYZ();
        const gp_Dir normal = face.NormalTransformed(node);
        positions.insert(positions.end(), {static_cast<float>(point.X()), static_cast<float>(point.Y()), static_cast<float>(point.Z())});
        normals.insert(normals.end(), {static_cast<float>(normal.X()), static_cast<float>(normal.Y()), static_cast<float>(normal.Z())});
        colors.insert(colors.end(), {static_cast<float>(color.GetRGB().Red()), static_cast<float>(color.GetRGB().Green()),
                                     static_cast<float>(color.GetRGB().Blue()), color.Alpha()});
      }

      std::vector<uint32_t>& target = color.Alpha() < 0.999f ? translucent : opaque;
      const uint32_t first = static_cast<uint32_t>(target.size());
      for (int element = face.ElemLower(); element <= face.ElemUpper(); ++element) {
        const Poly_Triangle triangle = face.TriangleOriented(element);
        for (int corner = 1; corner <= 3; ++corner) {
          target.push_back(base + static_cast<uint32_t>(triangle(corner) - face.NodeLower()));
        }
      }
      ranges.insert(ranges.end(), {&target == &translucent ? 1u : 0u, first, static_cast<uint32_t>(target.size()) - first});
      topology.faces.push_back(face.Face());
    }

    data.positionCount_ = static_cast<int>(positions.size());
    data.positions_ = j3d::copyToMalloc(positions);
    data.normals_ = j3d::copyToMalloc(normals);

    // Translucent ranges start after every opaque index once the two are joined.
    std::vector<uint32_t> faceRanges;
    faceRanges.reserve(ranges.size() / 3 * 2);
    for (std::size_t i = 0; i < ranges.size(); i += 3) {
      faceRanges.push_back(ranges[i + 1] + (ranges[i] != 0 ? static_cast<uint32_t>(opaque.size()) : 0u));
      faceRanges.push_back(ranges[i + 2]);
    }
    data.faceRangeCount_ = static_cast<int>(faceRanges.size());
    data.faceRanges_ = j3d::copyToMalloc(faceRanges);

    data.opaqueIndexCount_ = static_cast<int>(opaque.size());
    opaque.insert(opaque.end(), translucent.begin(), translucent.end());
    data.indexCount_ = static_cast<int>(opaque.size());
    data.indices_ = j3d::copyToMalloc(opaque);

    const Quantity_ColorRGBA single = haveFirst ? first : fallback;
    data.uniform_[0] = single.GetRGB().Red();
    data.uniform_[1] = single.GetRGB().Green();
    data.uniform_[2] = single.GetRGB().Blue();
    data.uniform_[3] = single.Alpha();
    if (!uniform) {
      data.colorCount_ = static_cast<int>(colors.size());
      data.colors_ = j3d::copyToMalloc(colors);
    }
  }

  // True BREP edges as line segments, taken from the face triangulations so they sit exactly on the
  // shaded mesh. Seam and degenerated edges are skipped; free edges are discretised from the curve.
  void extractEdges(const Prototype& prototype, J3DMeshData& data, Topology& topology) const {
    std::vector<float> segments;
    std::vector<uint32_t> edgeRanges;
    // Records the segments added since `first` points as one edge, if there are any.
    const auto addEdge = [&](const TopoDS_Edge& edge, std::size_t first) {
      const std::size_t points = segments.size() / 3;
      if (points > first) {
        edgeRanges.insert(edgeRanges.end(), {static_cast<uint32_t>(first), static_cast<uint32_t>(points - first)});
        topology.edges.push_back(edge);
      }
    };
    const auto addSegment = [&segments](const gp_Pnt& a, const gp_Pnt& b) {
      segments.insert(segments.end(), {static_cast<float>(a.X()), static_cast<float>(a.Y()), static_cast<float>(a.Z()),
                                       static_cast<float>(b.X()), static_cast<float>(b.Y()), static_cast<float>(b.Z())});
    };

    NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
    TopExp::MapShapesAndAncestors(prototype.shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

    for (int i = 1; i <= edgeFaces.Extent(); ++i) {
      const TopoDS_Edge& edge = TopoDS::Edge(edgeFaces.FindKey(i));
      if (BRep_Tool::Degenerated(edge)) {
        continue;
      }

      const std::size_t first = segments.size() / 3;
      const NCollection_List<TopoDS_Shape>& faces = edgeFaces.FindFromIndex(i);
      if (faces.IsEmpty()) {
        appendFreeEdge(edge, addSegment);
        addEdge(edge, first);
        continue;
      }

      const TopoDS_Face& face = TopoDS::Face(faces.First());
      if (BRep_Tool::IsClosed(edge, face)) {
        continue;  // seam
      }

      TopLoc_Location location;
      const Handle(Poly_Triangulation)& triangulation = BRep_Tool::Triangulation(face, location);
      if (triangulation.IsNull()) {
        continue;
      }
      const Handle(Poly_PolygonOnTriangulation) polygon =
          BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
      if (polygon.IsNull()) {
        continue;
      }

      const gp_Trsf& trsf = location.Transformation();
      for (int n = 1; n < polygon->NbNodes(); ++n) {
        addSegment(triangulation->Node(polygon->Node(n)).Transformed(trsf),
                   triangulation->Node(polygon->Node(n + 1)).Transformed(trsf));
      }
      addEdge(edge, first);
    }

    data.edgeCount_ = static_cast<int>(segments.size());
    data.edges_ = j3d::copyToMalloc(segments);
    data.edgeRangeCount_ = static_cast<int>(edgeRanges.size());
    data.edgeRanges_ = j3d::copyToMalloc(edgeRanges);
  }

  void extractVertices(const Prototype& prototype, J3DMeshData& data, Topology& topology) const {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
    TopExp::MapShapes(prototype.shape, TopAbs_VERTEX, vertices);
    std::vector<float> points;
    points.reserve(static_cast<std::size_t>(vertices.Extent()) * 3);
    for (int i = 1; i <= vertices.Extent(); ++i) {
      const TopoDS_Vertex& vertex = TopoDS::Vertex(vertices.FindKey(i));
      const gp_Pnt point = BRep_Tool::Pnt(vertex);
      points.insert(points.end(), {static_cast<float>(point.X()), static_cast<float>(point.Y()), static_cast<float>(point.Z())});
      topology.vertices.push_back(vertex);
    }
    data.vertexCount_ = static_cast<int>(points.size());
    data.vertices_ = j3d::copyToMalloc(points);
  }

  template <typename AddSegment>
  void appendFreeEdge(const TopoDS_Edge& edge, const AddSegment& addSegment) const {
    try {
      BRepAdaptor_Curve curve(edge);
      GCPnts_TangentialDeflection points(curve, angularDeflection_, linearDeflection_);
      for (int p = 1; p < points.NbPoints(); ++p) {
        addSegment(points.Value(p), points.Value(p + 1));
      }
    } catch (const Standard_Failure&) {
      // Edges without a usable 3D curve are simply not drawn.
    }
  }

  char* input_ = nullptr;
  std::size_t inputLength_ = 0;
  Handle(TDocStd_Document) document_;
  Handle(XCAFDoc_ShapeTool) shapeTool_;
  std::vector<Prototype> prototypes_;
  mutable std::vector<Topology> topology_;
  std::string sceneJson_ = "{\"nodes\":[],\"instances\":[]}";
  std::string lastError_;
  // Shared rather than owned so J3DModel stays copyable for the bindgen.
  std::shared_ptr<OutputBuffer> output_ = std::make_shared<OutputBuffer>();
  double linearDeflection_ = 0.1;
  double angularDeflection_ = 0.35;
};
