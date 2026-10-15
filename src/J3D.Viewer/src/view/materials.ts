import { Color, DoubleSide, LinearSRGBColorSpace, LineBasicMaterial, MeshStandardMaterial, type Material } from 'three';
import { SurfaceMetalness, SurfaceRoughness } from './surface';

/** Near-black BREP edges (docs/plan.md §6.6). */
export const EdgeColour = 0x0c0d0f;

/** Per-vertex 0/1 on a model's merged edges: 0 for the segments of hidden parts (D94). */
export const EdgeVisibilityAttribute = 'edgeVisible';

/** Linear RGBA, as the OCCT facade reports colours. */
export type LinearRgba = readonly [number, number, number, number];

interface Entry {
  material: Material;
  key: string;
  references: number;
}

/**
 * Materials shared between models, created on first use and disposed when their last user releases
 * them (docs/plan.md §6.3). Surface materials are keyed by colour (or "vertex colours") and by
 * whether they belong to an opaque or a translucent index range.
 */
export class MaterialCache {
  private readonly byKey = new Map<string, Entry>();
  private readonly byMaterial = new Map<Material, Entry>();

  /**
   * A surface material for one index range of a BREP prototype.
   * @param colour The prototype's single colour, or null when it has per-vertex RGBA colours.
   * @param translucent Whether the range is the prototype's translucent one (alpha below 1).
   */
  surface(colour: LinearRgba | null, translucent: boolean): MeshStandardMaterial {
    const key = `surface:${colour ? colour.map((c) => c.toFixed(4)).join(',') : 'vertex'}:${translucent ? 't' : 'o'}`;
    return this.acquire(key, () => createSurfaceMaterial(colour, translucent)) as MeshStandardMaterial;
  }

  /**
   * The edge material. The instanced one reads each copy's transform from an `instanceMatrix`
   * attribute; the other draws a model's merged edges and drops the segments whose
   * {@link EdgeVisibilityAttribute} is 0, so hidden parts' edges vanish without a rebuild (D94).
   */
  edges(instanced: boolean): LineBasicMaterial {
    return this.acquire(`edges:${instanced}`, () => {
      const material = new LineBasicMaterial({ color: EdgeColour });
      if (instanced) {
        // Three only defines USE_INSTANCING for InstancedMesh; lines get it from the material
        // (the shader prefix declares `instanceMatrix` under that define).
        material.defines = { USE_INSTANCING: '' };
      } else {
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\nattribute float ${EdgeVisibilityAttribute};`)
            .replace(
              '#include <project_vertex>',
              // Both ends of a hidden segment go outside the clip volume, so nothing of it is drawn.
              `#include <project_vertex>\n\tif ( ${EdgeVisibilityAttribute} < 0.5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );`,
            );
        };
        material.customProgramCacheKey = () => 'j3d-edge-visibility';
      }
      return material;
    }) as LineBasicMaterial;
  }

  release(material: Material): void {
    const entry = this.byMaterial.get(material);
    if (entry && --entry.references === 0) {
      this.byKey.delete(entry.key);
      this.byMaterial.delete(material);
      material.dispose();
    }
  }

  /** Number of live materials, for tests. */
  get size(): number {
    return this.byKey.size;
  }

  dispose(): void {
    for (const { material } of this.byKey.values()) {
      material.dispose();
    }
    this.byKey.clear();
    this.byMaterial.clear();
  }

  private acquire(key: string, create: () => Material): Material {
    let entry = this.byKey.get(key);
    if (!entry) {
      entry = { material: create(), key, references: 0 };
      this.byKey.set(key, entry);
      this.byMaterial.set(entry.material, entry);
    }
    entry.references++;
    return entry.material;
  }
}

function createSurfaceMaterial(colour: LinearRgba | null, translucent: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: colour ? new Color().setRGB(colour[0], colour[1], colour[2], LinearSRGBColorSpace) : 0xffffff,
    vertexColors: colour === null,
    metalness: SurfaceMetalness,
    roughness: SurfaceRoughness,
    // Open shells and surfaces are visible from both sides.
    side: DoubleSide,
    // Pushes faces back a little so the edges drawn on them aren't half hidden.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  if (translucent) {
    // Per-colour opacity, or each vertex's alpha when the colours are per vertex (decision D34).
    material.transparent = true;
    material.opacity = colour ? colour[3] : 1;
    material.depthWrite = false;
  }
  return material;
}
