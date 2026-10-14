import { describe, expect, it } from 'vitest';
import { ProgressIntervalMs, throttleProgress } from './progress';
import type { ImportPhase } from './types';

function harness() {
  let time = 0;
  const calls: [ImportPhase, number | null][] = [];
  const report = throttleProgress(
    (phase, fraction) => calls.push([phase, fraction]),
    () => time,
  );
  return { calls, report, advance: (ms: number) => (time += ms) };
}

describe('throttleProgress', () => {
  it('limits updates within a phase to one per interval', () => {
    const { calls, report, advance } = harness();
    report('reading', 0.1);
    report('reading', 0.2);
    advance(ProgressIntervalMs - 1);
    report('reading', 0.3);
    advance(1);
    report('reading', 0.4);
    expect(calls).toEqual([
      ['reading', 0.1],
      ['reading', 0.4],
    ]);
  });

  it('always passes a phase change and the end of a phase, but not exact repeats', () => {
    const { calls, report } = harness();
    report('reading', 0);
    report('reading', 1);
    report('reading', 1);
    report('parsing', null);
    report('parsing', null);
    expect(calls).toEqual([
      ['reading', 0],
      ['reading', 1],
      ['parsing', null],
    ]);
  });
});
