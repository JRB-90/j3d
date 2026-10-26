import { describe, expect, it } from 'vitest';
import { decodeEdits, encodeEdits } from './edits-codec';
import type { ModelEdits } from './structure';

/** The example J3D.Web.Client.Tests' EditsCodecTests packs, with the numbers and text it expects. */
const example: ModelEdits = {
  added: [3, -1],
  children: [{ parent: 0, nodes: [5, 2] }],
  names: [{ node: 5, name: 'Bracket set' }],
  pieces: [{ node: 6, expands: 1, piece: 0, name: 'Bolt é', part: true }],
};
const exampleNumbers = [1, 2, 3, -1, 1, 0, 2, 5, 2, 1, 5, 11, 1, 6, 1, 0, 1, 6];
const exampleText = 'Bracket setBolt é';

describe('edits codec', () => {
  it('reads the layout .NET writes', () => {
    const numbers = new Uint8Array(Int32Array.from(exampleNumbers).buffer);
    expect(decodeEdits(numbers, exampleText)).toEqual(example);
  });

  it('writes the same layout, and reads it back', () => {
    const { numbers, text } = encodeEdits(example);
    expect([...new Int32Array(numbers.buffer)]).toEqual(exampleNumbers);
    expect(text).toBe(exampleText);
    expect(decodeEdits(numbers, text)).toEqual(example);
  });

  it('keeps edits from before M15 without pieces', () => {
    const edits: ModelEdits = { added: [], children: [], names: [] };
    const { numbers, text } = encodeEdits(edits);
    expect(decodeEdits(numbers, text)).toEqual(edits);
  });

  it('reads bytes that start part-way into their buffer', () => {
    const { numbers, text } = encodeEdits(example);
    const padded = new Uint8Array(numbers.length + 1);
    padded.set(numbers, 1);
    expect(decodeEdits(padded.subarray(1), text)).toEqual(example);
  });

  it('refuses another version, or a buffer cut short', () => {
    const { numbers, text } = encodeEdits(example);
    const other = new Int32Array(numbers.slice().buffer);
    other[0] = 2;
    expect(() => decodeEdits(new Uint8Array(other.buffer), text)).toThrow(/version/);
    expect(() => decodeEdits(numbers.subarray(0, 16), text)).toThrow(/early/);
  });
});
