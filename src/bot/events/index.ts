/**
 * The single wiring point for gateway event handlers. Import each handler and register
 * it here; bindHandlers (called at login) attaches them all. Adding a handler is: write
 * its module, then add one registerEvent line below.
 */
import { registerEvent } from './registry.js';
import { interactionCreate } from './interaction-create.js';
import { guildMemberAdd } from './guild-member-add.js';

registerEvent(interactionCreate);
registerEvent(guildMemberAdd);
