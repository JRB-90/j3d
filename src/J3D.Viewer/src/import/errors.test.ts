import { describe, expect, it } from 'vitest';
import { ModelImportError, OutOfMemoryMessage, OutOfWasmMemoryMessage, toImportError } from './errors';

class OcctImportError extends Error {
  override name = 'OcctImportError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

describe('toImportError', () => {
  it('keeps a ModelImportError as it is', () => {
    expect(toImportError(new ModelImportError('MissingFile', 'scene.bin is missing'))).toEqual({
      code: 'MissingFile',
      message: 'scene.bin is missing',
    });
  });

  it.each([
    [1, 'ParseFailed'],
    [2, 'Empty'],
    [4, 'Internal'],
  ])('maps OCCT status %i to %s', (status, code) => {
    expect(toImportError(new OcctImportError(status, 'from C++'))).toEqual({ code, message: 'from C++' });
  });

  it('reports memory exhaustion in a worker as the 4 GB WebAssembly limit', () => {
    const expected = { code: 'OutOfMemory', message: OutOfWasmMemoryMessage };
    expect(toImportError(new OcctImportError(3, 'Out of memory.'), true)).toEqual(expected);
    expect(toImportError(new RangeError('Array buffer allocation failed'), true)).toEqual(expected);
    expect(toImportError(new Error('Aborted(Cannot enlarge memory arrays)'), true)).toEqual(expected);
    expect(toImportError('std::bad_alloc', true)).toEqual(expected);
  });

  it('reports memory exhaustion on the main thread as the browser limit', () => {
    expect(toImportError(new RangeError('Invalid string length'))).toEqual({ code: 'OutOfMemory', message: OutOfMemoryMessage });
  });

  it('treats anything else as Internal', () => {
    expect(toImportError(new TypeError('x is undefined'))).toEqual({ code: 'Internal', message: 'x is undefined' });
    expect(toImportError(undefined)).toEqual({ code: 'Internal', message: 'undefined' });
  });
});
