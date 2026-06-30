/**
 * The bot's authenticated Discord REST client.
 *
 * A standalone REST client (no gateway connection) is all that posting a channel message
 * needs — `POST /channels/{id}/messages` is a plain REST call. Keeping it independent of the
 * gateway Client means delivery works even while the gateway is mid-reconnect, and lets the
 * delivery service be constructed and unit-tested without a live bot. discord.js's REST client
 * carries the per-bucket and global rate-limit queue, so all bot writes are throttled centrally.
 *
 * This is the same construction the command-registration script uses; factoring it here lets
 * both build the client one way.
 */
import { REST } from 'discord.js';

export function createBotRest(token: string): REST {
  return new REST({ version: '10' }).setToken(token);
}
