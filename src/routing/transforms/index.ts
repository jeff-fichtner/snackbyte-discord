/**
 * The single wiring point for named transforms. The default transform is always available
 * via the registry; import each named transform here and register it. Importing this module
 * (done by the bootstrap) is what makes the registrations take effect.
 */
import { registerTransform } from './registry.js';
import { githubTransform } from './github.js';

registerTransform('github', githubTransform);

export { resolveTransform, registerTransform } from './registry.js';
