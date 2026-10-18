import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { sceneMaterials } from './oit';

describe('sceneMaterials', () => {
  it('sorts the models\' materials into translucent and opaque, and lists what draws translucent ones', () => {
    const opaque = new MeshStandardMaterial();
    const translucent = new MeshStandardMaterial({ transparent: true, opacity: 0.4 });
    const geometry = new BoxGeometry();
    const plain = new Mesh(geometry, opaque);
    const cover = new Mesh(geometry, translucent);
    const twoRanges = new InstancedMesh(geometry, [opaque, translucent], 2);
    const model = new Group().add(plain, new Group().add(cover));
    const other = new Group().add(twoRanges);

    const materials = sceneMaterials([model, other]);

    expect([...materials.translucent]).toEqual([translucent]);
    expect([...materials.opaque]).toEqual([opaque]);
    expect(materials.objects.map(({ object }) => object)).toEqual([cover, twoRanges]);
    expect(materials.objects[1]!.material).toEqual([opaque, translucent]);
  });

  it('finds nothing translucent in an opaque scene, so frames draw as before', () => {
    const materials = sceneMaterials([new Group().add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))]);
    expect(materials.translucent.size).toBe(0);
    expect(materials.objects).toEqual([]);
  });
});
