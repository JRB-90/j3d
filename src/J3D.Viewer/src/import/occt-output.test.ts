import { describe, expect, it } from 'vitest';
import { occtOutput } from './occt-output';

describe('occtOutput', () => {
  it('passes lines on, except while muted', () => {
    const lines: string[] = [];
    const output = occtOutput((text) => lines.push(text));
    output.print('before');
    const result = output.muted(() => {
      output.print('during');
      return 42;
    });
    output.print('after');
    expect(result).toBe(42);
    expect(lines).toEqual(['before', 'after']);
  });

  it('passes lines on again after a muted action throws', () => {
    const lines: string[] = [];
    const output = occtOutput((text) => lines.push(text));
    expect(() =>
      output.muted(() => {
        throw new Error('Export failed.');
      }),
    ).toThrow('Export failed.');
    output.print('after');
    expect(lines).toEqual(['after']);
  });
});
