import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeTextureSupport } from './gltf-import.js';

/** A canvas whose getContext('webgl2') returns `gl`. */
function stubDocument(gl: unknown) {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => gl }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeTextureSupport', () => {
  it('reports no compressed formats when WebGL is unavailable', () => {
    stubDocument(null);
    const { extensions } = probeTextureSupport();
    expect(extensions.has('WEBGL_compressed_texture_s3tc')).toBe(false);
    expect(extensions.has('WEBGL_compressed_texture_astc')).toBe(false);
  });

  it('reports the context’s extensions, keeps ASTC profiles and releases the context', () => {
    const loseContext = vi.fn();
    stubDocument({
      getSupportedExtensions: () => ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_astc'],
      getExtension: (name: string) =>
        name === 'WEBGL_compressed_texture_astc'
          ? { getSupportedProfiles: () => ['ldr', 'hdr'] }
          : name === 'WEBGL_lose_context'
            ? { loseContext }
            : {},
    });

    const { extensions } = probeTextureSupport();
    expect(extensions.has('WEBGL_compressed_texture_s3tc')).toBe(true);
    expect(extensions.has('EXT_texture_compression_bptc')).toBe(false);
    expect(
      (extensions.get('WEBGL_compressed_texture_astc') as unknown as { getSupportedProfiles(): string[] }).getSupportedProfiles(),
    ).toEqual(['ldr', 'hdr']);
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
