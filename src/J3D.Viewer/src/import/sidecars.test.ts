import { describe, expect, it } from 'vitest';
import { planBatch, resolvePath, SidecarSet, type BatchFile } from './sidecars.js';

const entry = (path: string, fromFolder = false): BatchFile => ({
  file: new File(['x'], path.slice(path.lastIndexOf('/') + 1)),
  path,
  ...(fromFolder ? { fromFolder } : {}),
});

describe('planBatch', () => {
  it('splits models, sidecars and unsupported files', () => {
    const plan = planBatch([entry('scene.gltf'), entry('scene.bin'), entry('part.STEP'), entry('notes.txt'), entry('Makefile')]);

    expect(plan.models.map((m) => [m.file.path, m.format])).toEqual([
      ['scene.gltf', 'gltf'],
      ['part.STEP', 'step'],
    ]);
    expect(plan.sidecars.files.map((f) => f.path)).toEqual(['scene.bin']);
    expect(plan.rejected).toEqual([
      { fileName: 'notes.txt', reason: ".txt files aren't supported." },
      { fileName: 'Makefile', reason: "Files without an extension aren't supported." },
    ]);
  });

  it('skips unsupported files found inside dropped folders without reporting them', () => {
    const plan = planBatch([entry('model/scene.gltf', true), entry('model/README.md', true), entry('model/.DS_Store', true)]);
    expect(plan.models).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });
});

describe('SidecarSet', () => {
  it('matches a relative path inside a dropped folder before a bare file name', () => {
    const nested = entry('car/textures/paint.png', true);
    const elsewhere = entry('other/paint.png', true);
    const set = new SidecarSet([elsewhere, nested]);
    expect(set.find('textures/paint.png', 'car/car.gltf')).toBe(nested);
  });

  it('falls back to the file name, ignoring case, for picked files', () => {
    const texture = entry('Paint.PNG');
    expect(new SidecarSet([texture]).find('textures/paint.png', 'car.gltf')).toBe(texture);
  });

  it('decodes percent-encoded URIs and tolerates names that are not encoded', () => {
    const spaced = entry('my texture.png');
    const percent = entry('100%.png');
    const set = new SidecarSet([spaced, percent]);
    expect(set.find('my%20texture.png', 'a.gltf')).toBe(spaced);
    expect(set.find('100%.png', 'a.obj')).toBe(percent);
  });

  it('reports chosen sidecars nobody used, but not unused files from folders', () => {
    const used = entry('scene.bin');
    const unused = entry('spare.png');
    const fromFolder = entry('dir/thumbnail.png', true);
    const set = new SidecarSet([used, unused, fromFolder]);
    set.find('scene.bin', 'scene.gltf');
    expect(set.unused()).toEqual([unused]);
  });

  it('returns undefined for a missing file', () => {
    expect(new SidecarSet([entry('a.bin')]).find('b.bin', 'scene.gltf')).toBeUndefined();
  });
});

describe('resolvePath', () => {
  it.each([
    ['', 'a.png', 'a.png'],
    ['car', './tex/a.png', 'car/tex/a.png'],
    ['car/models', '../tex/a.png', 'car/tex/a.png'],
    ['car', 'tex\\a.png', 'car/tex/a.png'],
  ])('resolves %j + %j', (base, relative, expected) => {
    expect(resolvePath(base, relative)).toBe(expected);
  });
});
