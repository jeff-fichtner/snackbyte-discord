/**
 * The single wiring point for component handlers. Import each handler and register it here; the
 * component dispatcher (called from interactionCreate) routes to them by customId prefix. Adding a
 * component style is: write its handler, then add one registerComponent line below.
 */
import { registerComponent } from './registry.js';
import { roleComponent } from './role-component.js';

registerComponent(roleComponent);
