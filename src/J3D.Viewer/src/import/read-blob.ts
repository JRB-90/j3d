/** Reads a whole Blob into one exactly sized buffer, reporting the fraction read as it streams. */
export async function readBlob(blob: Blob, onProgress: (fraction: number) => void): Promise<Uint8Array> {
  const bytes = new Uint8Array(blob.size);
  let offset = 0;
  onProgress(0);
  const reader = blob.stream().getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    bytes.set(chunk.value, offset);
    offset += chunk.value.byteLength;
    onProgress(blob.size === 0 ? 1 : offset / blob.size);
  }
  onProgress(1);
  return bytes;
}
