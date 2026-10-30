import type { ImportError, ImportErrorCode } from './types.js';

export const OutOfWasmMemoryMessage = "Model too large for the browser's 4 GB WebAssembly limit.";
export const OutOfMemoryMessage = "Model too large for the browser's memory.";

/** An import failure with one of the codes in docs/plan.md §6.2. */
export class ModelImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModelImportError';
  }

  toJSON(): ImportError {
    return { code: this.code, message: this.message };
  }
}

// OCCT facade statuses (wrappers/j3d_facade.cpp), by number so this module doesn't load the facade.
const occtStatusCodes: Readonly<Record<number, ImportErrorCode>> = {
  1: 'ParseFailed',
  2: 'Empty',
  3: 'OutOfMemory',
  4: 'Internal',
};

const outOfMemoryPattern =
  /out of memory|allocation failed|cannot enlarge memory|could not allocate|invalid (typed )?array length|invalid string length|bad_alloc|\bOOM\b/i;

/**
 * Maps anything an import can throw to an {@link ImportError}. Memory exhaustion is recognised from
 * the OCCT status, JS `RangeError`s and WebAssembly abort messages.
 */
export function toImportError(error: unknown, wasm = false): ImportError {
  if (error instanceof ModelImportError) {
    return error.toJSON();
  }

  const message = errorMessage(error);
  const status = isOcctImportError(error) ? error.status : undefined;
  const code = status === undefined ? undefined : occtStatusCodes[status];
  if (code === 'OutOfMemory' || (code === undefined && (error instanceof RangeError || outOfMemoryPattern.test(message)))) {
    return { code: 'OutOfMemory', message: wasm ? OutOfWasmMemoryMessage : OutOfMemoryMessage };
  }

  return { code: code ?? 'Internal', message: message || 'The import failed.' };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : String(error);
}

function isOcctImportError(error: unknown): error is Error & { status: number } {
  return error instanceof Error && error.name === 'OcctImportError' && typeof (error as { status?: unknown }).status === 'number';
}
