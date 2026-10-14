/**
 * The CAD surface finish shared by BREP parts and mesh models, so both look alike under the same
 * lighting (docs/plan.md §6.3 and §6.6, decision D46). Constants only: the lazily loaded mesh
 * importer uses them too.
 */
export const SurfaceMetalness = 0.05;
export const SurfaceRoughness = 0.55;

/** Neutral grey for parts and meshes without a colour of their own. */
export const NeutralGrey = 0xb4b9c0;
