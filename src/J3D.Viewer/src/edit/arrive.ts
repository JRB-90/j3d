import type { ArrivalsState, ModelContent } from '../import/types.js';
import { arrivalBase, EditsMismatchError, type ArrivalContent, type Arrivals, type KeptArrival } from './structure.js';

/** Reads a mesh model's arrival from its GLB (M18, D227): the viewer's, since it needs three's loader. */
export type MeshArrivalReader = (file: Blob) => Promise<ArrivalContent>;

/** The arrivals a model has read in so far (M18), by file. */
export function arrivalsOf(content: ModelContent): Arrivals {
  return new Map((content.arrivals?.loaded ?? []).map(({ file, nodes, objects }) => [file, { nodes, ...(objects ? { objects } : {}) }]));
}

function stateOf(content: ModelContent): ArrivalsState {
  return (content.arrivals ??= { loaded: [], files: new Map() });
}

/**
 * Reads in the arrivals a model's edits list (M18, D225, D227), those it hasn't yet, before the edits
 * are applied: a restored model's from its kept files (`read`), and one that an undo and a newer arrival
 * replaced from the bytes it came with. A BREP model's are numbered one after another from the file's
 * node count (`arrivalBase`), so each must be in the facade where its place in the list says; the first
 * that isn't is read in there, which drops the facade's later ones, and so are the rest. Throws
 * {@link EditsMismatchError} when one can't be read.
 */
export async function readArrivals(
  content: ModelContent,
  fileCount: number,
  kept: readonly KeptArrival[] | undefined,
  read: (file: string) => Promise<Blob>,
  readMesh?: MeshArrivalReader,
): Promise<Arrivals> {
  if (!kept?.length) {
    return arrivalsOf(content);
  }
  const state = stateOf(content);
  for (const [index, { file, nodes }] of kept.entries()) {
    const base = arrivalBase(fileCount, kept, index);
    const loaded = content.kind === 'brep' ? state.loaded[index] : state.loaded.find((arrival) => arrival.file === file);
    if (loaded?.file === file && (content.kind !== 'brep' || loaded.base === base)) {
      continue;
    }
    let arrival: ArrivalContent;
    try {
      const bytes = state.files.get(file) ?? (await read(file));
      state.files.set(file, bytes);
      arrival = await readOne(content, bytes, base, readMesh);
    } catch (error) {
      throw new EditsMismatchError(`The objects that arrived in ${file} couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (arrival.nodes.length !== nodes) {
      throw new EditsMismatchError(`The objects that arrived in ${file} aren't the ones the edits name.`);
    }
    if (content.kind === 'brep') {
      state.loaded.length = index; // the facade dropped what came after
    }
    state.loaded.push({ ...arrival, file, base });
  }
  return arrivalsOf(content);
}

/**
 * Reads objects that have just arrived (M18): appended after the arrivals `kept` lists, as the edits
 * that name them will list it. Returns what was read, for the edit.
 */
export async function addArrival(
  content: ModelContent,
  fileCount: number,
  kept: readonly KeptArrival[],
  file: string,
  bytes: Blob,
  readMesh?: MeshArrivalReader,
): Promise<ArrivalContent> {
  const state = stateOf(content);
  const base = arrivalBase(fileCount, kept, kept.length);
  const arrival = await readOne(content, bytes, base, readMesh);
  state.files.set(file, bytes);
  if (content.kind === 'brep') {
    state.loaded.length = Math.min(state.loaded.length, kept.length);
  }
  state.loaded.push({ ...arrival, file, base });
  return arrival;
}

async function readOne(content: ModelContent, bytes: Blob, base: number, readMesh: MeshArrivalReader | undefined): Promise<ArrivalContent> {
  if (content.kind === 'mesh') {
    if (!readMesh) {
      throw new Error("Objects can't arrive in this model.");
    }
    return readMesh(bytes);
  }
  if (!content.arriver) {
    throw new Error("Objects can't arrive in this model.");
  }
  const { arrival, prototypes } = await content.arriver.arrive(bytes, base);
  content.scene.prototypes.push(...prototypes);
  return { nodes: arrival.nodes };
}
