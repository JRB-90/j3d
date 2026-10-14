import type { ModelFormat } from '../formats';
import type { MeshRunnerOptions } from './mesh/mesh-import';
import { createOcctRunner, type OcctRunnerOptions } from './occt-import';
import type { ImportRunner, ImportTask } from './runner';

export interface RunnerOptions extends MeshRunnerOptions {
  occt?: OcctRunnerOptions;
}

/** Picks the importer for each format. Mesh importers (and Three.js) load on first use. */
export function createRunners(options: RunnerOptions = {}): (format: ModelFormat) => ImportRunner {
  const occt = createOcctRunner(options.occt);
  const mesh = lazyRunner(() => import('./mesh/mesh-import').then((m) => m.createMeshRunner(options)));
  return (format) => {
    switch (format) {
      case 'step':
      case 'iges':
      case 'brep':
        return occt;
      case 'stl':
      case 'obj':
      case 'gltf':
        return mesh;
    }
  };
}

/** A runner whose implementation is loaded with a dynamic import the first time it runs. */
export function lazyRunner(load: () => Promise<ImportRunner>): ImportRunner {
  let loaded: Promise<ImportRunner> | undefined;
  return (request) => {
    let task: ImportTask | undefined;
    let disposed = false;
    const result = (loaded ??= load()).then((runner) => {
      if (disposed) {
        return new Promise<never>(() => {});
      }
      task = runner(request);
      return task.result;
    });
    return {
      result,
      dispose() {
        disposed = true;
        task?.dispose();
      },
    };
  };
}
