import type { ImportPhase } from './types';

/** `fraction` is in [0, 1], or `null` while the phase has no measurable progress. */
export type ProgressListener = (phase: ImportPhase, fraction: number | null) => void;

/** Interval between progress reports within a phase: at most 10 per second (docs/plan.md §6.2). */
export const ProgressIntervalMs = 100;

/**
 * Wraps a listener so a new phase and the end of a phase always get through, exact repeats are
 * dropped, and other updates within a phase are limited to one per {@link ProgressIntervalMs}.
 */
export function throttleProgress(listener: ProgressListener, now: () => number = () => performance.now()): ProgressListener {
  let lastPhase: ImportPhase | undefined;
  let lastFraction: number | null = null;
  let lastTime = Number.NEGATIVE_INFINITY;
  return (phase, fraction) => {
    if (phase === lastPhase && fraction === lastFraction) {
      return;
    }
    const time = now();
    if (phase !== lastPhase || fraction === 1 || time - lastTime >= ProgressIntervalMs) {
      lastPhase = phase;
      lastFraction = fraction;
      lastTime = time;
      listener(phase, fraction);
    }
  };
}
