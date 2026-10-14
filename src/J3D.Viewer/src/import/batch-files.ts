import type { BatchFile } from './sidecars';

/** The files of one picker selection. */
export function filesFromInput(input: HTMLInputElement): BatchFile[] {
  return [...(input.files ?? [])].map((file) => ({ file, path: file.name }));
}

/**
 * The files of one drop, with dropped folders expanded recursively (decision D43) so a multi-file
 * glTF dropped as a folder groups with its buffers and textures.
 *
 * Call this synchronously from the `drop` handler: the browser invalidates `DataTransfer.items`
 * once the event has been dispatched, so the entries are taken before the first `await`.
 */
export function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<BatchFile[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve([...dataTransfer.files].map((file) => ({ file, path: file.name })));
  }
  return collect(entries as FileSystemEntry[]);
}

async function collect(entries: readonly FileSystemEntry[]): Promise<BatchFile[]> {
  const files: BatchFile[] = [];
  const visit = async (entry: FileSystemEntry, inFolder: boolean): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push({ file, path: entry.fullPath.replace(/^\/+/, ''), ...(inFolder ? { fromFolder: true } : {}) });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns the children in chunks (about 100 in Chromium) until it returns none.
      for (let chunk = await readEntries(reader); chunk.length > 0; chunk = await readEntries(reader)) {
        for (const child of chunk) {
          await visit(child, true);
        }
      }
    }
  };

  for (const entry of entries) {
    await visit(entry, false);
  }
  return files;
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}
