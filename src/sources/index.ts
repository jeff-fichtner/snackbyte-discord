/**
 * The single wiring point for inbound source adapters. Import each adapter and register
 * it here — nothing else in the codebase references a specific source. Adding a source
 * is: write its adapter, then add one registerSource line below.
 */
import { registerSource } from './registry.js';
import { clickupAdapter } from './clickup/adapter.js';
import { githubAdapter } from './github/adapter.js';

registerSource(clickupAdapter);
registerSource(githubAdapter);
