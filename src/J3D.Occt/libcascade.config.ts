import { defineBuild } from '@libcascade/toolchain';

/**
 * Custom OCCT 8 WebAssembly build for J3D, following Replicad's approach (a trimmed libcascade build
 * plus project-owned C++ wrappers). Almost all work happens inside the C++ facade
 * (wrappers/j3d_facade.cpp), so the JS-visible surface is tiny: import, mesh, extract.
 *
 * Build:   npx libcascade build && npx libcascade assemble   (needs Docker; normally run by CI)
 * Inspect: npx libcascade build --render-only               (no container)
 */
export default defineBuild({
  name: 'j3d_occt',
  bindings: ['J3DModel', 'J3DMeshData'],
  customBindings: [{ file: 'wrappers/j3d_facade.cpp', symbols: ['J3DModel', 'J3DMeshData'] }],
  settings: {
    MODULARIZE: true,
    EXPORT_ES6: true,
    ENVIRONMENT: ['web', 'worker', 'node'],
    ALLOW_MEMORY_GROWTH: true,
    INITIAL_MEMORY: '64MB',
    MAXIMUM_MEMORY: '4GB',
    STACK_SIZE: 8388608,
    WASM_BIGINT: true,
    EVAL_CTORS: 2,
    EXPORTED_RUNTIME_METHODS: [
      'FS',
      'wasmMemory',
      'HEAPU8',
      'HEAPF32',
      'HEAPU32',
      'getExceptionMessage',
      'incrementExceptionRefcount',
      'decrementExceptionRefcount',
    ],
  },
  compilerFlags: { optimize: 'O3', simd: true, exceptions: 'wasm', noEntry: true },
  variants: [
    // Default (decision D28). Selection order is declaration order among equally capable variants,
    // and the viewer pins the variant explicitly anyway.
    { name: 'single' },
    {
      name: 'multi',
      compilerFlags: { threads: true },
      // Constructor evaluation order is non-deterministic under pthread workers.
      settings: { EVAL_CTORS: null, SHARED_MEMORY: true },
    },
  ],
});
