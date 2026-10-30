import { describe, expect, it } from 'vitest';
import { filesFromDataTransfer } from './batch-files.js';

// Minimal stand-ins for the File and Directory Entries API, which Node doesn't have.
const file = (fullPath: string) => ({
  isFile: true,
  isDirectory: false,
  fullPath,
  file: (resolve: (file: File) => void) => resolve(new File(['x'], fullPath.slice(fullPath.lastIndexOf('/') + 1))),
});

/** A directory whose reader hands out children two at a time, like Chromium's 100-entry chunks. */
const directory = (fullPath: string, children: unknown[]) => ({
  isFile: false,
  isDirectory: true,
  fullPath,
  createReader: () => {
    let next = 0;
    return {
      readEntries: (resolve: (entries: unknown[]) => void) => {
        resolve(children.slice(next, next + 2));
        next += 2;
      },
    };
  },
});

const dataTransfer = (entries: unknown[], files: File[] = []) =>
  ({ items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })), files }) as unknown as DataTransfer;

describe('filesFromDataTransfer', () => {
  it('expands dropped folders recursively, keeping folder-relative paths', async () => {
    const drop = dataTransfer([
      file('/part.step'),
      directory('/car', [
        file('/car/car.gltf'),
        file('/car/car.bin'),
        directory('/car/textures', [file('/car/textures/paint.png')]),
        file('/car/README.md'),
      ]),
    ]);

    const files = await filesFromDataTransfer(drop);
    expect(files.map((f) => [f.path, f.file.name, f.fromFolder ?? false])).toEqual([
      ['part.step', 'part.step', false],
      ['car/car.gltf', 'car.gltf', true],
      ['car/car.bin', 'car.bin', true],
      ['car/textures/paint.png', 'paint.png', true],
      ['car/README.md', 'README.md', true],
    ]);
  });

  it('falls back to the flat file list when entries are unavailable', async () => {
    const plain = new File(['x'], 'scan.stl');
    const drop = { items: [{ kind: 'file', webkitGetAsEntry: () => null }], files: [plain] } as unknown as DataTransfer;
    expect(await filesFromDataTransfer(drop)).toEqual([{ file: plain, path: 'scan.stl' }]);
  });

  it("uses the drop's own File when a top-level file entry can't be read (WebKit)", async () => {
    const plain = new File(['x'], 'scan.stl');
    const unreadable = {
      isFile: true,
      isDirectory: false,
      name: 'scan.stl',
      fullPath: '/scan.stl',
      file: (_: unknown, reject: (error: Error) => void) => reject(new Error('NotFoundError: Path does not exist')),
    };
    const drop = dataTransfer([unreadable, file('/part.step')], [plain]);
    expect((await filesFromDataTransfer(drop)).map((f) => [f.path, f.file])).toEqual([
      ['scan.stl', plain],
      ['part.step', expect.any(File)],
    ]);
  });

  it('ignores non-file items such as dragged text', async () => {
    const drop = { items: [{ kind: 'string' }], files: [] } as unknown as DataTransfer;
    expect(await filesFromDataTransfer(drop)).toEqual([]);
  });
});
