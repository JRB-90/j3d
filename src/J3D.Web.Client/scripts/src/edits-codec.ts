import type { ArrivedNode, ExpandedNode, KeptArrival, ModelEdits } from '@j3d/viewer';

/**
 * A model's edits packed for interop (M16, D199): .NET sends all of a model's edits with each one
 * (§6.4), and as JSON the large plant's after Expand all took 160 ms to serialise under the WebAssembly
 * interpreter, every edit. Packed, its numbers cross as one buffer of 32-bit integers (Blazor passes
 * bytes without JSON) and its names as one string. J3D.Web.Client's EditsCodec writes the same layout:
 *
 * `version, added.length, ...added, children.length, (parent, nodes.length, ...nodes)*, names.length,
 * (node, name length)*, pieces.length or -1 when absent, (node, expands, piece, part 0/1, name length)*`,
 * with the names, then the pieces' names, one after another in `text` (lengths in UTF-16 code units).
 * Since M18 an arrivals section may follow: `arrivals.length, (nodes, file length)*, arrived.length,
 * (node, arrival, index, part 0/1, expandable 0/1, name length)*`, the files and the arrived nodes'
 * names after the pieces' in `text`. Edits without it end after the pieces.
 */
export const EditsCodecVersion = 1;

export function decodeEdits(numbers: Uint8Array, text: string): ModelEdits {
  // The bytes may start anywhere in their buffer, so they're copied to read them as integers.
  const values = new Int32Array(numbers.slice().buffer);
  let at = 0;
  let textAt = 0;
  const next = () => {
    if (at >= values.length) {
      throw new Error('The packed edits end early.');
    }
    return values[at++]!;
  };
  const nextText = () => {
    const length = next();
    const value = text.slice(textAt, textAt + length);
    textAt += length;
    return value;
  };
  const list = <T>(read: () => T): T[] => Array.from({ length: next() }, read);

  if (next() !== EditsCodecVersion) {
    throw new Error('The packed edits are of another version.');
  }
  const added = list(next);
  const children = list(() => ({ parent: next(), nodes: list(next) }));
  const names = list(() => ({ node: next(), name: nextText() }));
  const count = next();
  const pieces =
    count < 0
      ? undefined
      : Array.from({ length: count }, (): ExpandedNode => {
          const [node, expands, piece, part] = [next(), next(), next(), next()];
          return { node, expands, piece, name: nextText(), part: part !== 0 };
        });
  if (at >= values.length) {
    return { added, children, names, ...(pieces ? { pieces } : {}) };
  }
  const arrivals = list((): KeptArrival => {
    const nodes = next();
    return { file: nextText(), nodes };
  });
  const arrived = list((): ArrivedNode => {
    const [node, arrival, index, part, expandable] = [next(), next(), next(), next(), next()];
    return { node, arrival, index, name: nextText(), part: part !== 0, ...(expandable !== 0 ? { expandable: true } : {}) };
  });
  return { added, children, names, ...(pieces ? { pieces } : {}), arrivals, arrived };
}

/** The same packing from the viewer's side, for tests and to check a round trip. */
export function encodeEdits(edits: ModelEdits): { numbers: Uint8Array; text: string } {
  const values: number[] = [EditsCodecVersion];
  let text = '';
  const addText = (value: string) => {
    values.push(value.length);
    text += value;
  };
  values.push(edits.added.length, ...edits.added);
  values.push(edits.children.length);
  for (const { parent, nodes } of edits.children) {
    values.push(parent, nodes.length, ...nodes);
  }
  values.push(edits.names.length);
  for (const { node, name } of edits.names) {
    values.push(node);
    addText(name);
  }
  values.push(edits.pieces ? edits.pieces.length : -1);
  for (const { node, expands, piece, part, name } of edits.pieces ?? []) {
    values.push(node, expands, piece, part ? 1 : 0);
    addText(name);
  }
  if (edits.arrivals || edits.arrived) {
    values.push(edits.arrivals?.length ?? 0);
    for (const { file, nodes } of edits.arrivals ?? []) {
      values.push(nodes);
      addText(file);
    }
    values.push(edits.arrived?.length ?? 0);
    for (const { node, arrival, index, part, expandable, name } of edits.arrived ?? []) {
      values.push(node, arrival, index, part ? 1 : 0, expandable ? 1 : 0);
      addText(name);
    }
  }
  return { numbers: new Uint8Array(Int32Array.from(values).buffer), text };
}
