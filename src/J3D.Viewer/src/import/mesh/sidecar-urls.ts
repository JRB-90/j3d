import type { Sidecars } from '../sidecars.js';

/** A 1×1 white PNG, used in place of a texture that wasn't supplied so nothing is fetched from the server. */
export const MissingTextureUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4////fwAJ+wP99djxmgAAAABJRU5ErkJggg==';

/**
 * A `LoadingManager` URL modifier that serves a model's relative references (buffers, textures)
 * from the batch's sidecar files through `blob:` URLs (docs/plan.md §6.2, step 3).
 */
export class SidecarUrls {
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly sidecars: Sidecars,
    private readonly fromPath: string,
    private readonly warnings: string[],
  ) {}

  readonly modifier = (url: string): string => {
    if (/^(data|blob|https?):/i.test(url)) {
      return url; // embedded data, or the self-hosted decoders
    }
    let resolved = this.urls.get(url);
    if (resolved === undefined) {
      const sidecar = this.sidecars.find(url, this.fromPath);
      if (sidecar) {
        resolved = URL.createObjectURL(sidecar.file);
      } else {
        resolved = MissingTextureUrl;
        this.warnings.push(`Texture "${url}" wasn't supplied, so the model is shown without it.`);
      }
      this.urls.set(url, resolved);
    }
    return resolved;
  };

  /** True once any reference has gone through {@link modifier}. */
  get used(): boolean {
    return this.urls.size > 0;
  }

  revoke(): void {
    for (const url of this.urls.values()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
  }
}
