// J3D OCCT facade, compiled into the custom libcascade build (see ../libcascade.config.ts).
//
// Follows Replicad's wrapper pattern: plain C++ classes that the libcascade bindgen exposes to JS
// (scope 'all'), with bulk data returned as malloc'd arrays whose addresses and lengths JS reads
// straight out of WASM memory. One J3DModel lives in one Web Worker and owns one XCAF document.
//
// Pipeline: importFile (STEP/IGES/BREP -> XCAF document) -> mesh (BRepMesh per unique part)
//           -> getSceneJson (assembly tree + instances) + extractPrototype(i) (geometry per part/style).
//
// Addresses are returned as unsigned int: with MAXIMUM_MEMORY=4GB they can exceed INT_MAX.

#include <BRepBndLib.hxx>
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
#include <Standard_Failure.hxx>
#include <Standard_OutOfMemory.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFPrs_DocumentExplorer.hxx>
#include <XCAFPrs_Style.hxx>

#include <emscripten.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <istream>
#include <new>
#include <sstream>
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

constexpr int PhaseParsing = 1;
constexpr int PhaseTransferring = 2;
constexpr int PhaseMeshing = 3;
constexpr int PhaseExtracting = 4;

// Neutral grey for parts without a colour, in linear RGB (#B4B9C0 in sRGB).
const Quantity_ColorRGBA DefaultColor(Quantity_Color(0.456, 0.485, 0.527, Quantity_TOC_RGB), 1.0f);

// Reports progress to the worker through `Module.j3dProgress(phase, fraction)` when it is set.
// Throttled to ~10 Hz; fraction < 0 means indeterminate.
void reportProgress(int phase, double fraction, bool force = false) {
  static double lastReport = 0.0;
  const double now = emscripten_get_now();
  if (!force && now - lastReport < 100.0) {
    return;
  }
  lastReport = now;
  // clang-format off
  EM_ASM({ if (Module['j3dProgress']) Module['j3dProgress']($0, $1); }, phase, fraction);
  // clang-format on
}

// OCCT progress indicator that forwards transfer progress to reportProgress.
class ProgressIndicator : public Message_ProgressIndicator {
public:
  explicit ProgressIndicator(int phase) : phase_(phase) {}

protected:
  void Show(const Message_ProgressScope&, const Standard_Boolean isForce) override {
    reportProgress(phase_, GetPosition(), isForce);
  }

private:
  int phase_;
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

bool useParallelMeshing() {
#if defined(__EMSCRIPTEN_PTHREADS__)
  const Handle(OSD_ThreadPool)& pool = OSD_ThreadPool::DefaultPool(-1);
  pool->SetNbDefaultThreadsToLaunch(pool->NbThreads());
  return pool->NbThreads() > 1;
#else
  return false;
#endif
}

std::string labelName(const TDF_Label& label) {
  Handle(TDataStd_Name) name;
  if (label.IsNull() || !label.FindAttribute(TDataStd_Name::GetID(), name)) {
    return {};
  }
  // ExtendedString -> UTF-8.
  return TCollection_AsciiString(name->Get()).ToCString();
}

void appendJsonString(std::string& out, const std::string& value) {
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

void appendNumber(std::string& out, double value) {
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.9g", std::isfinite(value) ? value : 0.0);
  out += buffer;
}

// Column-major 4x4 (Three.js Matrix4.fromArray order).
void appendMatrix(std::string& out, const gp_Trsf& trsf) {
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

Quantity_ColorRGBA styleColor(const XCAFPrs_Style& style) {
  return style.IsSetColorSurf() ? style.GetColorSurfRGBA() : DefaultColor;
}

std::string styleKey(const XCAFPrs_Style& style) {
  if (!style.IsSetColorSurf()) {
    return "-";
  }
  const Quantity_ColorRGBA color = style.GetColorSurfRGBA();
  char buffer[96];
  std::snprintf(buffer, sizeof(buffer), "%.6f,%.6f,%.6f,%.6f", color.GetRGB().Red(), color.GetRGB().Green(),
                color.GetRGB().Blue(), color.GetAlpha());
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
  }

  // Embind copies return values; like Replicad's mesh data, a copy takes ownership of the buffers.
  J3DMeshData(const J3DMeshData& other)
      : positions_(other.positions_), normals_(other.normals_), indices_(other.indices_),
        colors_(other.colors_), edges_(other.edges_), positionCount_(other.positionCount_),
        indexCount_(other.indexCount_), opaqueIndexCount_(other.opaqueIndexCount_),
        colorCount_(other.colorCount_), edgeCount_(other.edgeCount_), uniform_{other.uniform_[0], other.uniform_[1], other.uniform_[2], other.uniform_[3]} {
    auto& source = const_cast<J3DMeshData&>(other);
    source.positions_ = nullptr;
    source.normals_ = nullptr;
    source.indices_ = nullptr;
    source.colors_ = nullptr;
    source.edges_ = nullptr;
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

private:
  static unsigned int address(const void* data) {
    return static_cast<unsigned int>(reinterpret_cast<std::uintptr_t>(data));
  }

  float* positions_ = nullptr;
  float* normals_ = nullptr;
  uint32_t* indices_ = nullptr;
  float* colors_ = nullptr;
  float* edges_ = nullptr;
  int positionCount_ = 0;
  int indexCount_ = 0;
  int opaqueIndexCount_ = 0;
  int colorCount_ = 0;
  int edgeCount_ = 0;
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
        BRepMesh_IncrementalMesh(prototypes_[i].shape, linearDeflection, Standard_False, angularDeflection, parallel);
      }
      linearDeflection_ = linearDeflection;
      angularDeflection_ = angularDeflection;
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
    extractFaces(prototype, data);
    extractEdges(prototype, data);
    return data;
  }

  /**
   * JSON: { nodes: [{ name, parent, prototype }], instances: [{ node, prototype, matrix }] }.
   * prototype is -1 for assemblies; matrix is the instance's world transform (column-major 4x4).
   */
  std::string getSceneJson() const { return sceneJson_; }

  /** Message for the last non-OK status. */
  std::string getLastError() const { return lastError_; }

private:
  struct Prototype {
    TDF_Label label;
    TopoDS_Shape shape;
    XCAFPrs_Style style;
  };

  template <typename Body>
  int guarded(Body&& body) {
    try {
      lastError_.clear();
      return body();
    } catch (const Standard_OutOfMemory&) {
      return fail(j3d::StatusOutOfMemory, "Out of memory.");
    } catch (const std::bad_alloc&) {
      return fail(j3d::StatusOutOfMemory, "Out of memory.");
    } catch (const Standard_Failure& failure) {
      return fail(j3d::StatusParseFailed, std::string(failure.DynamicType()->Name()) + ": " +
                                              (failure.GetMessageString() ? failure.GetMessageString() : ""));
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
    j3d::MemoryStreamBuffer buffer(input_, inputLength_);
    std::istream stream(&buffer);

    STEPCAFControl_Reader reader;
    reader.SetColorMode(Standard_True);
    reader.SetNameMode(Standard_True);
    reader.SetLayerMode(Standard_False);
    reader.SetPropsMode(Standard_False);
    if (reader.ReadStream(fileName.c_str(), stream) != IFSelect_RetDone) {
      return fail(j3d::StatusParseFailed, "Not a readable STEP file.");
    }

    Handle(j3d::ProgressIndicator) progress = new j3d::ProgressIndicator(j3d::PhaseTransferring);
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
    reader.SetColorMode(Standard_True);
    reader.SetNameMode(Standard_True);
    reader.SetLayerMode(Standard_False);
    const IFSelect_ReturnStatus status = reader.ReadFile(path);
    std::remove(path);
    if (status != IFSelect_RetDone) {
      return fail(j3d::StatusParseFailed, "Not a readable IGES file.");
    }

    Handle(j3d::ProgressIndicator) progress = new j3d::ProgressIndicator(j3d::PhaseTransferring);
    if (!reader.Transfer(document_, progress->Start())) {
      return fail(j3d::StatusParseFailed, "The IGES file could not be translated.");
    }
    return j3d::StatusOk;
  }

  int importBrep(const std::string& fileName) {
    j3d::MemoryStreamBuffer buffer(input_, inputLength_);
    std::istream stream(&buffer);

    TopoDS_Shape shape;
    BRep_Builder builder;
    Handle(j3d::ProgressIndicator) progress = new j3d::ProgressIndicator(j3d::PhaseTransferring);
    BRepTools::Read(shape, stream, builder, progress->Start());
    if (shape.IsNull()) {
      return fail(j3d::StatusParseFailed, "Not a readable BREP file.");
    }

    const TDF_Label label = shapeTool_->AddShape(shape, Standard_False);
    TDataStd_Name::Set(label, TCollection_ExtendedString(fileName.c_str(), Standard_True));
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

  void extractFaces(const Prototype& prototype, J3DMeshData& data) const {
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> colors;
    std::vector<uint32_t> opaque;
    std::vector<uint32_t> translucent;
    bool uniform = true;
    Quantity_ColorRGBA first;
    bool haveFirst = false;

    const Quantity_ColorRGBA fallback = j3d::styleColor(prototype.style);
    for (RWMesh_FaceIterator face(prototype.label, TopLoc_Location(), Standard_True, prototype.style); face.More();
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
        colors.insert(colors.end(), {color.GetRGB().Red(), color.GetRGB().Green(), color.GetRGB().Blue(), color.GetAlpha()});
      }

      std::vector<uint32_t>& target = color.GetAlpha() < 0.999f ? translucent : opaque;
      for (int element = face.ElemLower(); element <= face.ElemUpper(); ++element) {
        const Poly_Triangle triangle = face.TriangleOriented(element);
        for (int corner = 1; corner <= 3; ++corner) {
          target.push_back(base + static_cast<uint32_t>(triangle(corner) - face.NodeLower()));
        }
      }
    }

    data.positionCount_ = static_cast<int>(positions.size());
    data.positions_ = j3d::copyToMalloc(positions);
    data.normals_ = j3d::copyToMalloc(normals);

    data.opaqueIndexCount_ = static_cast<int>(opaque.size());
    opaque.insert(opaque.end(), translucent.begin(), translucent.end());
    data.indexCount_ = static_cast<int>(opaque.size());
    data.indices_ = j3d::copyToMalloc(opaque);

    const Quantity_ColorRGBA single = haveFirst ? first : fallback;
    data.uniform_[0] = single.GetRGB().Red();
    data.uniform_[1] = single.GetRGB().Green();
    data.uniform_[2] = single.GetRGB().Blue();
    data.uniform_[3] = single.GetAlpha();
    if (!uniform) {
      data.colorCount_ = static_cast<int>(colors.size());
      data.colors_ = j3d::copyToMalloc(colors);
    }
  }

  // True BREP edges as line segments, taken from the face triangulations so they sit exactly on the
  // shaded mesh. Seam and degenerated edges are skipped; free edges are discretised from the curve.
  void extractEdges(const Prototype& prototype, J3DMeshData& data) const {
    std::vector<float> segments;
    const auto addSegment = [&segments](const gp_Pnt& a, const gp_Pnt& b) {
      segments.insert(segments.end(), {static_cast<float>(a.X()), static_cast<float>(a.Y()), static_cast<float>(a.Z()),
                                       static_cast<float>(b.X()), static_cast<float>(b.Y()), static_cast<float>(b.Z())});
    };

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(prototype.shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

    for (int i = 1; i <= edgeFaces.Extent(); ++i) {
      const TopoDS_Edge& edge = TopoDS::Edge(edgeFaces.FindKey(i));
      if (BRep_Tool::Degenerated(edge)) {
        continue;
      }

      const TopTools_ListOfShape& faces = edgeFaces.FindFromIndex(i);
      if (faces.IsEmpty()) {
        appendFreeEdge(edge, addSegment);
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
    }

    data.edgeCount_ = static_cast<int>(segments.size());
    data.edges_ = j3d::copyToMalloc(segments);
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
  std::string sceneJson_ = "{\"nodes\":[],\"instances\":[]}";
  std::string lastError_;
  double linearDeflection_ = 0.1;
  double angularDeflection_ = 0.35;
};
