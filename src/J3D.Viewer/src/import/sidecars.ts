import { detectFormat, extensionOf, isSidecar, type ModelFormat } from '../formats.js';

/** A file from one picker selection or drop. */
export interface BatchFile {
  file: File;
  /**
   * Path within the batch, with `/` separators and no leading slash. A picked file's path is its
   * name; files from a dropped folder keep their folder-relative path.
   */
  path: string;
  /**
   * Found inside a dropped folder rather than chosen individually. Such files are skipped silently
   * when they're unsupported or unused (a folder often holds READMEs, thumbnails and so on).
   */
  fromFolder?: boolean;
}

export interface BatchPlan {
  models: { file: BatchFile; format: ModelFormat }[];
  sidecars: SidecarSet;
  rejected: { fileName: string; reason: string }[];
}

/** Splits a batch into models, sidecars held back for matching, and unsupported files. */
export function planBatch(files: readonly BatchFile[]): BatchPlan {
  const plan: BatchPlan = { models: [], sidecars: new SidecarSet([]), rejected: [] };
  const sidecars: BatchFile[] = [];
  for (const entry of files) {
    const format = detectFormat(entry.file.name);
    if (format) {
      plan.models.push({ file: entry, format });
    } else if (isSidecar(entry.file.name)) {
      sidecars.push(entry);
    } else if (!entry.fromFolder) {
      const extension = extensionOf(entry.file.name);
      plan.rejected.push({
        fileName: entry.file.name,
        reason: extension ? `${extension} files aren't supported.` : "Files without an extension aren't supported.",
      });
    }
  }
  plan.sidecars = new SidecarSet(sidecars);
  return plan;
}

export const UnusedSidecarReason = 'Not used by any model in the same selection.';

/** Finds the files a model references (buffers, materials, textures) among its batch's sidecars. */
export interface Sidecars {
  find(uri: string, fromPath: string): BatchFile | undefined;
}

/** The sidecar files of one batch, and which of them models have claimed. */
export class SidecarSet implements Sidecars {
  private readonly used = new Set<BatchFile>();

  constructor(readonly files: readonly BatchFile[]) {}

  /**
   * Finds the file that a model at `fromPath` references as `uri`: by relative path first, then by
   * file name alone (case-insensitive), since picked files carry no folder information.
   */
  find(uri: string, fromPath: string): BatchFile | undefined {
    const target = resolvePath(dirname(fromPath), decodeUri(uri)).toLowerCase();
    const name = basename(target);
    const match =
      this.files.find((entry) => entry.path.toLowerCase() === target) ??
      this.files.find((entry) => basename(entry.path).toLowerCase() === name);
    if (match) {
      this.used.add(match);
    }
    return match;
  }

  /** Individually chosen sidecars that no model referenced. */
  unused(): BatchFile[] {
    return this.files.filter((entry) => !entry.fromFolder && !this.used.has(entry));
  }

  /** A view of the set for one model, recording the files it finds, which are kept with it (M8, D113). */
  forModel(found: Set<BatchFile>): Sidecars {
    return {
      find: (uri, fromPath) => {
        const match = this.find(uri, fromPath);
        if (match) {
          found.add(match);
        }
        return match;
      },
    };
  }
}

function decodeUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri; // not percent-encoded (e.g. an MTL file name containing '%')
  }
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Joins `relative` onto `base` and normalises `.`, `..` and backslashes. */
export function resolvePath(base: string, relative: string): string {
  const parts: string[] = [];
  for (const part of `${base}/${relative}`.replaceAll('\\', '/').split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '' && part !== '.') {
      parts.push(part);
    }
  }
  return parts.join('/');
}
