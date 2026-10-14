import { describe, expect, it } from 'vitest';
import { detectFormat, extensionOf, fileInputAccept, isSidecar, kindOf, type ModelFormat } from './formats';

describe('detectFormat', () => {
  it.each<[string, ModelFormat]>([
    ['bracket.step', 'step'],
    ['bracket.STP', 'step'],
    ['surface.iges', 'iges'],
    ['surface.igs', 'iges'],
    ['shape.brep', 'brep'],
    ['scan.stl', 'stl'],
    ['mesh.obj', 'obj'],
    ['scene.gltf', 'gltf'],
    ['scene.glb', 'gltf'],
    ['archive.v2.step', 'step'],
  ])('detects %s as %s', (fileName, expected) => {
    expect(detectFormat(fileName)).toBe(expected);
  });

  it.each(['README', 'drawing.dwg', 'model.step.zip', '.hidden', ''])('rejects %j', (fileName) => {
    expect(detectFormat(fileName)).toBeUndefined();
  });
});

describe('kindOf', () => {
  it('classifies OCCT formats as brep and the rest as mesh', () => {
    expect((['step', 'iges', 'brep'] as const).map(kindOf)).toEqual(['brep', 'brep', 'brep']);
    expect((['stl', 'obj', 'gltf'] as const).map(kindOf)).toEqual(['mesh', 'mesh', 'mesh']);
  });
});

describe('isSidecar', () => {
  it.each(['scene.bin', 'part.MTL', 'albedo.png', 'a.jpg', 'a.jpeg', 'a.webp', 'basecolor.ktx2'])('accepts %s', (fileName) => {
    expect(isSidecar(fileName)).toBe(true);
  });

  it.each(['part.step', 'scene.gltf', 'notes.txt', 'texture.tga', 'bin'])('rejects %s', (fileName) => {
    expect(isSidecar(fileName)).toBe(false);
  });
});

describe('extensionOf', () => {
  it('returns the lowercase last extension, or nothing', () => {
    expect([extensionOf('A.B.STEP'), extensionOf('README'), extensionOf('.hidden')]).toEqual(['.step', '', '.hidden']);
  });
});

describe('fileInputAccept', () => {
  it('lists every model and sidecar extension', () => {
    expect(fileInputAccept).toBe('.step,.stp,.iges,.igs,.brep,.stl,.obj,.gltf,.glb,.bin,.mtl,.png,.jpg,.jpeg,.webp,.ktx2');
  });
});
