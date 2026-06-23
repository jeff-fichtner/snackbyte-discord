/** /ping — proves the bot is online and responsive. Needs no routing store. */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommand } from './types.js';

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is responsive.'),
  async execute(interaction) {
    // Defer immediately to acknowledge within Discord's 3s window (avoids "Unknown
    // interaction" on any cold/slow path), then edit in the actual reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const latency = Math.max(0, Date.now() - interaction.createdTimestamp);
    await interaction.editReply({ content: `Pong! (${latency}ms)` });
  },
};
