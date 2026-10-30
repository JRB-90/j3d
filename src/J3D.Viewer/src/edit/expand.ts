import type { ModelContent } from '../import/types.js';
import { EditsMismatchError, type Expansions } from './structure.js';

const None: Expansions = new Map();

/** The file parts a model has expanded so far (M15), by file node. */
export function expansionsOf(content: ModelContent): Expansions {
  return content.kind === 'brep' ? (content.expansions ?? None) : None;
}

/**
 * Expands a BREP model's file parts in its worker, those not expanded yet, in order (M15, D154): their
 * pieces are kept with its content, and the prototypes they draw join its scene's, numbered as the
 * worker numbers them, since its answers come back in order. Throws {@link EditsMismatchError} when a
 * part can't be expanded. `onProgress` hears how many of the parts are done (a restore's phase, D203).
 */
export async function expandFileParts(
  content: ModelContent,
  fileNodes: readonly number[],
  onProgress?: (done: number, total: number) => void,
): Promise<Expansions> {
  if (content.kind !== 'brep') {
    if (fileNodes.length > 0) {
      throw new EditsMismatchError("A mesh model's parts can't be expanded.");
    }
    return None;
  }
  const expansions = (content.expansions ??= new Map());
  for (const [index, node] of fileNodes.entries()) {
    onProgress?.(index, fileNodes.length);
    if (expansions.has(node)) {
      continue;
    }
    if (!content.expander) {
      throw new EditsMismatchError("This model's parts can't be expanded.");
    }
    let expanded: Awaited<ReturnType<NonNullable<typeof content.expander>['expand']>>;
    try {
      expanded = await content.expander.expand(node);
    } catch (error) {
      throw new EditsMismatchError(`Node ${node} couldn't be expanded: ${error instanceof Error ? error.message : String(error)}`);
    }
    content.scene.prototypes.push(...expanded.prototypes);
    expansions.set(node, expanded.pieces);
  }
  return expansions;
}
