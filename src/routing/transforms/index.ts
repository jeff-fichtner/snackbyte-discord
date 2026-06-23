/**
 * The single wiring point for named transforms. The default transform is always
 * available via the registry; register additional named transforms here as they are
 * added. (None beyond the default in this slice.)
 */
export { resolveTransform, registerTransform } from './registry.js';
