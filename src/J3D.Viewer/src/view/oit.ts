import {
  CustomBlending,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  ZeroFactor,
  Color,
  type Camera,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';

/** What a frame drew, summed over its passes. */
export interface FrameCounts {
  drawCalls: number;
  triangles: number;
  lines: number;
}

/** The models' materials, sorted once per scene change (D129: the overlays aren't among them). */
export interface SceneMaterials {
  translucent: ReadonlySet<Material>;
  opaque: ReadonlySet<Material>;
  /** Objects drawing at least one translucent material, with what they draw. */
  objects: readonly { object: Object3D & { material: Material | Material[] }; material: Material | Material[] }[];
}

/** Sorts the materials of the models' objects into translucent and opaque. */
export function sceneMaterials(roots: readonly Object3D[]): SceneMaterials {
  const translucent = new Set<Material>();
  const opaque = new Set<Material>();
  const objects: SceneMaterials['objects'][number][] = [];
  for (const root of roots) {
    root.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) {
        return;
      }
      const list = Array.isArray(material) ? material : [material];
      let drawsTranslucent = false;
      for (const entry of list) {
        if (entry.transparent) {
          translucent.add(entry);
          drawsTranslucent = true;
        } else {
          opaque.add(entry);
        }
      }
      if (drawsTranslucent) {
        objects.push({ object: object as SceneMaterials['objects'][number]['object'], material });
      }
    });
  }
  return { translucent, opaque, objects };
}

/**
 * Weighted blended order-independent transparency (M10, D90, D129, D130; McGuire and Bavoil 2013).
 * Opaque surfaces are drawn to the canvas as usual. The translucent ones are drawn into two half-float
 * targets with one blend state: the first adds each fragment's colour × alpha × weight and multiplies
 * its alpha into (1 − alpha) products, the revealage; the second adds alpha × weight. A full-screen
 * pass then lays the weighted average colour over the canvas with coverage 1 − revealage, tone mapped
 * as the rest of the scene is. Nearer fragments weigh more, so whatever is in front reads as in front,
 * however the parts intersect, and nothing is sorted. The translucent pass is depth tested against
 * the opaque surfaces, drawn into the target first without colour. The overlays (selection, hover,
 * measurements) are drawn last, over everything, as before.
 */
export class OrderIndependentTransparency {
  private target: WebGLRenderTarget | undefined;
  private readonly clones = new Map<Material, Material>();
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new Vector2();
  private readonly clearColour = new Color();

  /** Whether this renderer can draw into blendable half-float targets (R21). */
  static isSupported(renderer: WebGLRenderer): boolean {
    return renderer.extensions.has('EXT_color_buffer_float') && renderer.extensions.has('EXT_float_blend');
  }

  constructor(private readonly renderer: WebGLRenderer) {
    this.quad = new Mesh(new PlaneGeometry(2, 2), compositeMaterial());
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * Draws the scene with its translucent model surfaces blended order-independently. The canvas has
   * been cleared; `models` are the models' roots, `overlays` what's drawn over them.
   */
  render(scene: Scene, camera: Camera, models: readonly Object3D[], overlays: Object3D, materials: SceneMaterials): FrameCounts {
    const renderer = this.renderer;
    const counts: FrameCounts = { drawCalls: 0, triangles: 0, lines: 0 };
    const count = () => {
      const { calls, triangles, lines } = renderer.info.render;
      counts.drawCalls += calls;
      counts.triangles += triangles;
      counts.lines += lines;
    };
    const { translucent, opaque } = materials;
    const target = this.targetFor(renderer.getDrawingBufferSize(this.size));
    const overlaysShown = overlays.visible;
    overlays.visible = false;

    try {
      // 1. Opaque surfaces, to the canvas.
      translucent.forEach((material) => (material.visible = false));
      renderer.render(scene, camera);
      count();

      // 2. Their depth, into the target: what the translucent surfaces are tested against.
      renderer.getClearColor(this.clearColour);
      const clearAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1); // no colour, nothing weighed, revealage 1
      renderer.clear(true, true, false);
      renderer.setClearColor(this.clearColour, clearAlpha);
      const colourWrites = new Map<Material, boolean>();
      opaque.forEach((material) => {
        colourWrites.set(material, material.colorWrite);
        material.colorWrite = false;
      });
      renderer.render(scene, camera);
      colourWrites.forEach((write, material) => (material.colorWrite = write));

      // 3. Translucent surfaces, weighed, into the target.
      opaque.forEach((material) => (material.visible = false));
      translucent.forEach((material) => (material.visible = true));
      for (const { object, material } of materials.objects) {
        object.material = Array.isArray(material) ? material.map((entry) => this.weighed(entry)) : this.weighed(material);
      }
      renderer.render(scene, camera);
      count();
      for (const { object, material } of materials.objects) {
        object.material = material;
      }
      opaque.forEach((material) => (material.visible = true));
      renderer.setRenderTarget(null);

      // 4. Their weighted average over the canvas.
      const uniforms = this.quad.material.uniforms;
      uniforms['accumulated']!.value = target.textures[0];
      uniforms['weights']!.value = target.textures[1];
      renderer.render(this.quadScene, this.quadCamera);
    } finally {
      translucent.forEach((material) => (material.visible = true));
      renderer.setRenderTarget(null);
      overlays.visible = overlaysShown;
    }

    // 5. The overlays, over everything.
    if (overlaysShown && overlays.children.length > 0) {
      const shown = models.map((model) => model.visible);
      models.forEach((model) => (model.visible = false));
      renderer.render(scene, camera);
      count();
      models.forEach((model, i) => (model.visible = shown[i]!));
    }
    return counts;
  }

  /** Frees the clones of materials no longer in the scene. */
  prune(materials: SceneMaterials): void {
    for (const [material, clone] of this.clones) {
      if (!materials.translucent.has(material)) {
        clone.dispose();
        this.clones.delete(material);
      }
    }
  }

  dispose(): void {
    this.clones.forEach((clone) => clone.dispose());
    this.clones.clear();
    this.target?.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }

  private targetFor(size: Vector2): WebGLRenderTarget {
    if (!this.target) {
      this.target = new WebGLRenderTarget(size.x, size.y, {
        count: 2,
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: true,
      });
    } else if (this.target.width !== size.x || this.target.height !== size.y) {
      this.target.setSize(size.x, size.y);
    }
    return this.target;
  }

  /** A translucent material's weighed copy; opaque entries of a material array are left as they are. */
  private weighed(material: Material): Material {
    if (!material.transparent) {
      return material;
    }
    let clone = this.clones.get(material);
    if (!clone) {
      clone = material.clone();
      clone.transparent = true;
      clone.depthWrite = false;
      clone.depthTest = true;
      clone.premultipliedAlpha = false;
      clone.blending = CustomBlending;
      clone.blendSrc = OneFactor;
      clone.blendDst = OneFactor;
      clone.blendSrcAlpha = ZeroFactor;
      clone.blendDstAlpha = OneMinusSrcAlphaFactor;
      const key = material.customProgramCacheKey();
      clone.customProgramCacheKey = () => `j3d-oit:${key}`;
      clone.onBeforeCompile = (shader) => {
        shader.fragmentShader = `layout(location = 1) out highp vec4 j3dWeights;\n${shader.fragmentShader.replace(/}\s*$/, `${WeighFragment}\n}`)}`;
      };
      this.clones.set(material, clone);
    }
    return clone;
  }
}

/**
 * The end of a translucent material's fragment shader in the weighed pass. Three writes straight
 * alpha in linear colour (no tone mapping into a render target). Nearer fragments (smaller depth
 * between the near and far planes, which hug the scene) weigh up to 3,000 times more.
 */
const WeighFragment = /* glsl */ `
  float j3dAlpha = clamp(gl_FragColor.a, 0.0, 1.0);
  float j3dWeight = j3dAlpha * max(1e-2, 3e3 * pow(1.0 - gl_FragCoord.z, 3.0));
  j3dWeights = vec4(j3dWeight, 0.0, 0.0, 0.0);
  gl_FragColor = vec4(gl_FragColor.rgb * j3dWeight, j3dAlpha);`;

/** Lays the weighted average colour over the canvas, premultiplied by its coverage, tone mapped like the scene. */
function compositeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { accumulated: { value: null }, weights: { value: null } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D accumulated;
      uniform sampler2D weights;
      void main() {
        ivec2 pixel = ivec2(gl_FragCoord.xy);
        vec4 sum = texelFetch(accumulated, pixel, 0);
        float coverage = 1.0 - sum.a;
        if (coverage <= 1e-4) discard;
        gl_FragColor = vec4(sum.rgb / max(texelFetch(weights, pixel, 0).r, 1e-5), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor = vec4(gl_FragColor.rgb * coverage, coverage);
      }`,
    toneMapped: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
}
