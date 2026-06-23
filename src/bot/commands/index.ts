/**
 * The single wiring point for slash commands. Import each command and register it here.
 * Adding a command is: write its module, then add one registerCommand line below.
 */
import { registerCommand } from './registry.js';
import { pingCommand } from './ping.js';

registerCommand(pingCommand);
