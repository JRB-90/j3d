import { describe, expect, it } from 'vitest';
import { detectFormat, fileInputAccept, kindOf, type ModelFormat } from './formats';

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

describe('fileInputAccept', () => {
  it('lists every supported extension', () => {
    expect(fileInputAccept).toBe('.step,.stp,.iges,.igs,.brep,.stl,.obj,.gltf,.glb');
  });
});
