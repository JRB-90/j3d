/** OCCT's printed output in a model worker (M11): one line of its standard output at a time. */
export interface OcctOutput {
  /** Emscripten's `print`: passes the line on, unless muted. */
  print(text: string): void;
  /** Runs `action` with the output dropped. */
  muted<T>(action: () => T): T;
}

/**
 * Passes OCCT's output to `log`, except while muted. A STEP export prints transfer statistics for
 * every shape it writes, about 100,000 lines for a 10,000-part model, and a console something is
 * listening to (DevTools, Playwright) made such an export 2.4 times slower and its Cancel take
 * seconds. Exports run muted: their failures come back through their status and message anyway.
 */
export function occtOutput(log: (text: string) => void): OcctOutput {
  let muting = 0;
  return {
    print: (text) => {
      if (muting === 0) {
        log(text);
      }
    },
    muted: (action) => {
      muting++;
      try {
        return action();
      } finally {
        muting--;
      }
    },
  };
}
