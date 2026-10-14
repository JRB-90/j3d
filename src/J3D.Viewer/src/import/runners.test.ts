import { describe, expect, it } from 'vitest';
import type { ImportRequest, ImportRunner } from './runner';
import { lazyRunner } from './runners';
import type { ImportResult } from './types';

const request = {} as ImportRequest;
const result = {} as ImportResult;

describe('lazyRunner', () => {
  it('loads the implementation once and delegates to it', async () => {
    let loads = 0;
    const runner = lazyRunner(async () => {
      loads++;
      const inner: ImportRunner = () => ({ result: Promise.resolve(result), dispose() {} });
      return inner;
    });

    await expect(runner(request).result).resolves.toBe(result);
    await expect(runner(request).result).resolves.toBe(result);
    expect(loads).toBe(1);
  });

  it('passes dispose on once the import has started, and never starts a disposed one', async () => {
    const started: string[] = [];
    let disposals = 0;
    const runner = lazyRunner(async () => () => {
      started.push('import');
      return { result: new Promise<never>(() => {}), dispose: () => disposals++ };
    });

    const early = runner(request);
    early.dispose();
    const late = runner(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    late.dispose();

    expect(started).toEqual(['import']);
    expect(disposals).toBe(1);
  });
});
