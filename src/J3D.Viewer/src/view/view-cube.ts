import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { ViewRegions, type ViewRegion } from './view-regions';

/** Size of the view cube's square, in CSS pixels, and its distance from the top-right corner (D31). */
export const ViewCubeSize = 110;
export const ViewCubeMargin = 12;

/** The cube's size in the compact layout, on a phone or a tablet held upright (M19, D240). */
export const CompactViewCubeSize = 80;

/** Width of the edge and corner bands, on a cube 2 units across. */
const Band = 0.32;
/** Gap left between neighbouring regions, so the cube reads as 26 clickable parts. */
const Seam = 0.03;

const FaceColour = new Color(0x3a404a);
const BandColour = new Color(0x2a2f37);
const HoverColour = new Color(0x4f9dff);
const LabelColour = '#e6e8eb';

/** Face labels and their orientation: the label's right and up directions as seen in that view. */
const Labels: Record<string, { text: string; right: [number, number, number]; up: [number, number, number] }> = {
  top: { text: 'TOP', right: [1, 0, 0], up: [0, 1, 0] },
  bottom: { text: 'BOTTOM', right: [1, 0, 0], up: [0, -1, 0] },
  front: { text: 'FRONT', right: [1, 0, 0], up: [0, 0, 1] },
  back: { text: 'BACK', right: [-1, 0, 0], up: [0, 0, 1] },
  right: { text: 'RIGHT', right: [0, 1, 0], up: [0, 0, 1] },
  left: { text: 'LEFT', right: [0, -1, 0], up: [0, 0, 1] },
};

/** One axis of a region's cell: the band at either end, or the face between them. */
function span(step: number): [number, number] {
  return step < 0 ? [-1, -1 + Band] : step > 0 ? [1 - Band, 1] : [-1 + Band, 1 - Band];
}

/**
 * The clickable orientation cube (decision D31). It is drawn by the viewer's renderer into a
 * scissored square at the top-right of the canvas, with its own orthographic camera turned like
 * the main one, and is made of 26 boxes, one per region, so a raycast tells which was hit.
 */
export class ViewCube {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10);
  private readonly cells: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  private readonly labels: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly raycaster = new Raycaster();
  private hovered: Mesh<BoxGeometry, MeshBasicMaterial> | undefined;
  /** The square's size in CSS pixels: smaller in the compact layout (M19, D240). */
  size = ViewCubeSize;

  constructor() {
    for (const region of ViewRegions) {
      const [x, y, z] = region.direction.map(span) as [number, number][];
      const geometry = new BoxGeometry(x![1] - x![0] - Seam, y![1] - y![0] - Seam, z![1] - z![0] - Seam);
      // Flat UI colours: no tone mapping.
      const material = new MeshBasicMaterial({ color: region.kind === 'face' ? FaceColour : BandColour, toneMapped: false });
      const cell = new Mesh(geometry, material);
      cell.position.set((x![0] + x![1]) / 2, (y![0] + y![1]) / 2, (z![0] + z![1]) / 2);
      cell.userData['region'] = region;
      this.cells.push(cell);
      this.scene.add(cell);

      const label = Labels[region.id];
      if (label) {
        this.labels.push(this.createLabel(region, label));
      }
    }
  }

  /** The cube's square in canvas CSS pixels, measured from the canvas's top-left corner. */
  bounds(canvasWidth: number): { left: number; top: number; size: number } {
    return { left: canvasWidth - ViewCubeMargin - this.size, top: ViewCubeMargin, size: this.size };
  }

  /** The region under a pointer, if any. */
  pick(clientX: number, clientY: number, canvas: DOMRect): ViewRegion | undefined {
    return this.cellAt(clientX, clientY, canvas)?.userData['region'] as ViewRegion | undefined;
  }

  /** Highlights a region (or none). Returns whether anything changed, so the caller knows to redraw. */
  setHovered(region: ViewRegion | undefined): boolean {
    const cell = region && this.cells.find((c) => c.userData['region'] === region);
    if (cell === this.hovered) {
      return false;
    }
    if (this.hovered) {
      const previous = this.hovered.userData['region'] as ViewRegion;
      this.hovered.material.color.copy(previous.kind === 'face' ? FaceColour : BandColour);
    }
    cell?.material.color.copy(HoverColour);
    this.hovered = cell;
    return true;
  }

  get hoveredRegion(): ViewRegion | undefined {
    return this.hovered?.userData['region'] as ViewRegion | undefined;
  }

  /**
   * Where a region appears on screen (client coordinates), or undefined when it faces away from the
   * viewer. Used by the tests to click edges and corners.
   */
  pointOf(region: ViewRegion, canvas: DOMRect): { x: number; y: number } | undefined {
    const cell = this.cells.find((c) => c.userData['region'] === region);
    if (!cell) {
      return undefined;
    }
    // The visible face of the cell lies on the cube's surface, in the region's direction.
    const point = new Vector3(...region.direction).multiplyScalar(1 - Band / 2);
    for (let axis = 0; axis < 3; axis++) {
      if (region.direction[axis] !== 0 && region.kind === 'face') {
        point.setComponent(axis, region.direction[axis]!);
      }
    }
    const towardsViewer = new Vector3(...region.direction).normalize().dot(this.camera.position.clone().normalize());
    if (towardsViewer < 0.2) {
      return undefined;
    }
    const ndc = point.project(this.camera);
    const { left, top, size } = this.bounds(canvas.width);
    const x = canvas.left + left + ((ndc.x + 1) / 2) * size;
    const y = canvas.top + top + ((1 - ndc.y) / 2) * size;
    // Only report it if a click there would really hit this region.
    return this.cellAt(x, y, canvas) === cell ? { x, y } : undefined;
  }

  /** Draws the cube over the main view, turned like `camera`. */
  render(renderer: WebGLRenderer, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.position.set(0, 0, 5).applyQuaternion(camera.quaternion);
    this.camera.updateMatrixWorld();

    const { left, top, size } = this.bounds(canvasWidth);
    const bottom = canvasHeight - top - size; // WebGL viewports start at the bottom left
    renderer.setScissorTest(true);
    renderer.setScissor(left, bottom, size, size);
    renderer.setViewport(left, bottom, size, size);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvasWidth, canvasHeight);
  }

  dispose(): void {
    for (const mesh of [...this.cells, ...this.labels]) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
  }

  private cellAt(clientX: number, clientY: number, canvas: DOMRect): Mesh<BoxGeometry, MeshBasicMaterial> | undefined {
    const { left, top, size } = this.bounds(canvas.width);
    const x = clientX - canvas.left - left;
    const y = clientY - canvas.top - top;
    if (x < 0 || y < 0 || x > size || y > size) {
      return undefined;
    }
    this.raycaster.setFromCamera(new Vector2((x / size) * 2 - 1, 1 - (y / size) * 2), this.camera);
    return this.raycaster.intersectObjects(this.cells, false)[0]?.object as Mesh<BoxGeometry, MeshBasicMaterial> | undefined;
  }

  private createLabel(region: ViewRegion, label: (typeof Labels)[string]): Mesh<PlaneGeometry, MeshBasicMaterial> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = LabelColour;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    let fontSize = 64;
    do {
      context.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      fontSize -= 4;
    } while (context.measureText(label.text).width > 216 && fontSize > 16);
    context.fillText(label.text, 128, 132);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const size = 2 - 2 * Band;
    const mesh = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    const right = new Vector3(...label.right);
    const up = new Vector3(...label.up);
    const normal = new Vector3(...region.direction);
    mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
    mesh.position.copy(normal).multiplyScalar(1 - Seam / 2 + 0.002);
    mesh.raycast = () => {}; // clicks go to the region underneath
    this.scene.add(mesh);
    return mesh;
  }
}
