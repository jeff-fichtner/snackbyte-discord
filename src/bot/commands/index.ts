/**
 * The single wiring point for slash commands. Import each command and register it here.
 * Adding a command is: write its module, then add one registerCommand line below.
 */
import { registerCommand } from './registry.js';
import { pingCommand } from './ping.js';
import { roleCommand } from './role.js';
import { rolesCommand } from './roles.js';
import { nickCommand } from './nick.js';
import { timeoutCommand } from './timeout.js';
import { kickCommand } from './kick.js';
import { banCommand } from './ban.js';
import { unbanCommand } from './unban.js';
import { bansCommand } from './bans.js';
import { purgeCommand } from './purge.js';
import { slowmodeCommand } from './slowmode.js';
import { lockCommand, unlockCommand } from './lock.js';
import { pinCommand, unpinCommand } from './pin.js';

registerCommand(pingCommand);
registerCommand(roleCommand);
registerCommand(rolesCommand);
registerCommand(nickCommand);
registerCommand(timeoutCommand);
registerCommand(kickCommand);
registerCommand(banCommand);
registerCommand(unbanCommand);
registerCommand(bansCommand);
registerCommand(purgeCommand);
registerCommand(slowmodeCommand);
registerCommand(lockCommand);
registerCommand(unlockCommand);
registerCommand(pinCommand);
registerCommand(unpinCommand);
