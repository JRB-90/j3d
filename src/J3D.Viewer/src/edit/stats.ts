import type { InstancedMesh, Mesh } from 'three';
import type { ModelContent, ModelStats } from '../import/types.js';
import type { ModelStructure } from './structure.js';

/**
 * What an edited model draws (M14): its live nodes, and the placements, triangles and edge segments
 * of its live parts, copies counted as their sources are. Textures stay as imported, and prototypes
 * too, since copies share them, but for those Expand adds (M15).
 */
export function editedStats(content: ModelContent, structure: ModelStructure, imported: ModelStats): ModelStats {
  let instances = 0;
  let triangles = 0;
  let edges = 0;
  let prototypes = imported.prototypes;
  if (content.kind === 'brep') {
    // A BREP part node is placed once, drawing its prototype; Expand's prototypes follow the file's (M15).
    const { scene } = content;
    for (const node of structure.parts()) {
      const mesh = scene.prototypes[structure.nodes[node]!.prototype]!;
      instances++;
      triangles += mesh.indices.length / 3;
      edges += mesh.edges.length / 6;
    }
    prototypes = scene.prototypes.length;
  } else {
    for (const node of structure.parts()) {
      const object = content.nodes[structure.fileNodes[node]!] as Partial<Mesh & InstancedMesh> | undefined;
      const count = object?.isInstancedMesh ? object.count! : 1;
      instances += count;
      if (object?.isMesh && object.geometry) {
        triangles += (count * (object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0)) / 3;
      }
    }
  }
  return { ...imported, nodes: structure.order().length, prototypes, instances, triangles: Math.floor(triangles), edges };
}
