import wasmUrl from '@j3d/occt/single/wasm?url';
import { ModelImportError, errorMessage } from './errors';

let compiled: Promise<WebAssembly.Module> | undefined;

/**
 * Compiles the OCCT WebAssembly module once per page. Each model worker instantiates this compiled
 * module instead of fetching and compiling the 15 MB binary again (docs/plan.md §3).
 */
export function compileOcctModule(): Promise<WebAssembly.Module> {
  compiled ??= compile().catch((error: unknown) => {
    compiled = undefined; // let a later import try again
    throw error instanceof WebAssembly.CompileError
      ? new ModelImportError('Unsupported', `This browser can't run the OCCT WebAssembly module: ${error.message}`)
      : new ModelImportError('Internal', `Couldn't load the OCCT WebAssembly module: ${errorMessage(error)}`);
  });
  return compiled;
}

async function compile(): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetchWasm());
  } catch (error) {
    // compileStreaming rejects with a TypeError when the server sends the wrong MIME type.
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return WebAssembly.compile(await (await fetchWasm()).arrayBuffer());
  }
}

async function fetchWasm(): Promise<Response> {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${response.url}`);
  }
  return response;
}
