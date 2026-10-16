import type { DirectoryHandle, FileHandle, SyncHandle } from './store-ops';

/**
 * An in-memory origin private file system for tests (Node has none), with a byte limit standing in
 * for the quota. Writes past it come up short, as in WebKit, or throw `QuotaExceededError`, as in
 * Chromium.
 */
export class FakeDisk {
  readonly root: FakeDirectory;
  /** Sync access handles opened so far: the store must close every one. */
  opened = 0;
  closed = 0;
  /** The size of each write, in order. */
  readonly writes: number[] = [];

  constructor(
    public limit = Infinity,
    public readonly fullWrites: 'short' | 'throw' = 'throw',
  ) {
    this.root = new FakeDirectory(this);
  }

  get used(): number {
    return this.root.size;
  }

  /** The files under a path, by path, for assertions. */
  files(): Record<string, string> {
    const files: Record<string, string> = {};
    const visit = (folder: FakeDirectory, prefix: string) => {
      for (const [name, entry] of folder.entries) {
        if (entry instanceof FakeDirectory) {
          visit(entry, `${prefix}${name}/`);
        } else {
          files[`${prefix}${name}`] = new TextDecoder().decode(entry.data);
        }
      }
    };
    visit(this.root, '');
    return files;
  }
}

export class FakeDirectory implements DirectoryHandle {
  readonly entries = new Map<string, FakeDirectory | FakeFileHandle>();

  constructor(private readonly disk: FakeDisk) {}

  get size(): number {
    let size = 0;
    for (const entry of this.entries.values()) {
      size += entry instanceof FakeDirectory ? entry.size : entry.data.byteLength;
    }
    return size;
  }

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    return Promise.resolve(this.entry(name, options?.create ?? false, () => new FakeDirectory(this.disk), FakeDirectory));
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    return Promise.resolve(this.entry(name, options?.create ?? false, () => new FakeFileHandle(name, this.disk), FakeFileHandle));
  }

  removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) {
      return Promise.reject(new DOMException(`${name} wasn't found.`, 'NotFoundError'));
    }
    return Promise.resolve();
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of [...this.entries.keys()]) {
      yield name;
    }
  }

  private entry<T extends FakeDirectory | FakeFileHandle>(
    name: string,
    create: boolean,
    make: () => T,
    type: abstract new (...args: never[]) => T,
  ): T {
    let entry = this.entries.get(name);
    if (!entry) {
      if (!create) {
        throw new DOMException(`${name} wasn't found.`, 'NotFoundError');
      }
      entry = make();
      this.entries.set(name, entry);
    }
    if (!(entry instanceof type)) {
      throw new DOMException(`${name} is the wrong kind of entry.`, 'TypeMismatchError');
    }
    return entry;
  }
}

export class FakeFileHandle implements FileHandle {
  data = new Uint8Array(0);

  constructor(
    readonly name: string,
    private readonly disk: FakeDisk,
  ) {}

  getFile(): Promise<File> {
    return Promise.resolve(new File([this.data.slice()], this.name));
  }

  createSyncAccessHandle(): Promise<SyncHandle> {
    this.disk.opened++;
    let open = true;
    const check = () => {
      if (!open) {
        throw new DOMException('The handle is closed.', 'InvalidStateError');
      }
    };
    return Promise.resolve({
      write: (buffer, { at }) => {
        check();
        this.disk.writes.push(buffer.byteLength);
        const room = this.disk.limit - this.disk.used + Math.max(0, this.data.byteLength - at);
        if (buffer.byteLength > room && this.disk.fullWrites === 'throw') {
          throw new DOMException('Quota exceeded.', 'QuotaExceededError');
        }
        const written = Math.max(0, Math.min(buffer.byteLength, room));
        const data = new Uint8Array(Math.max(this.data.byteLength, at + written));
        data.set(this.data);
        data.set(buffer.subarray(0, written), at);
        this.data = data;
        return written;
      },
      truncate: (size) => {
        check();
        this.data = this.data.slice(0, size);
      },
      flush: check,
      close: () => {
        check();
        open = false;
        this.disk.closed++;
      },
    });
  }
}
