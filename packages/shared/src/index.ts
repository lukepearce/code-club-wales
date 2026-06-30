// Public surface of @codeclub/shared.
//
// Shared types and Zod schemas live here. The pure domain modules live under
// ./domain and are re-exported below so apps can import them from either
// '@codeclub/shared' or the '@codeclub/shared/domain' subpath.
export * from './domain/index.js';

/** Marker export so the package always carries a value (used by smoke checks). */
export const SHARED_PACKAGE_NAME = '@codeclub/shared';
