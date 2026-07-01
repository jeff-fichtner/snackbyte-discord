/**
 * The single wiring point for slash commands. Import each command and register it here.
 * Adding a command is: write its module, then add one registerCommand line below.
 */
import { registerCommand } from './registry.js';
import { pingCommand } from './ping.js';
import { roleCommand } from './role.js';
import { rolesCommand } from './roles.js';
import { nickCommand } from './nick.js';

registerCommand(pingCommand);
registerCommand(roleCommand);
registerCommand(rolesCommand);
registerCommand(nickCommand);
