import type { InstancedMesh, Mesh } from 'three';
import type { ModelContent, ModelStats } from '../import/types';
import type { ModelStructure } from './structure';

/**
 * What an edited model draws (M14): its live nodes, and the placements, triangles and edge segments
 * of its live parts, copies counted as their sources are. Prototypes and textures stay as imported,
 * since copies share them.
 */
export function editedStats(content: ModelContent, structure: ModelStructure, imported: ModelStats): ModelStats {
  let instances = 0;
  let triangles = 0;
  let edges = 0;
  if (content.kind === 'brep') {
    const { scene } = content;
    const ofNode = new Map<number, number[]>();
    scene.instances.forEach((instance) => {
      const list = ofNode.get(instance.node);
      if (list) {
        list.push(instance.prototype);
      } else {
        ofNode.set(instance.node, [instance.prototype]);
      }
    });
    for (const node of structure.parts()) {
      for (const prototype of ofNode.get(structure.fileNodes[node]!) ?? []) {
        const mesh = scene.prototypes[prototype]!;
        instances++;
        triangles += mesh.indices.length / 3;
        edges += mesh.edges.length / 6;
      }
    }
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
  return { ...imported, nodes: structure.order().length, instances, triangles: Math.floor(triangles), edges };
}
