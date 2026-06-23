/** /ping — proves the bot is online and responsive. Needs no routing store. */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommand } from './types.js';

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is responsive.'),
  async execute(interaction) {
    const latency = Math.max(0, Date.now() - interaction.createdTimestamp);
    await interaction.reply({ content: `Pong! (${latency}ms)`, flags: MessageFlags.Ephemeral });
  },
};
