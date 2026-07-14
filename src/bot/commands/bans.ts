/**
 * /bans — list the server's current ban list with reasons. Gated by the invoker's native Ban
 * Members permission. Reply is ephemeral.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { listBans } from '../moderation/sanctions.js';
import { isModerator } from '../moderation/standing.js';
import { guildBanView } from './moderation-adapter.js';

const MAX_SHOWN = 50;

export const bansCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('bans').setDescription('List the current ban list.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('roles' in invoker)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    if (!isModerator((invoker as GuildMember).permissions, 'ban')) {
      await interaction.editReply({ content: 'You lack the Ban Members permission.' });
      return;
    }

    const bans = await listBans(guildBanView(interaction.guild)).catch(() => null);
    if (bans === null) {
      await interaction.editReply({ content: "Couldn't read the ban list." });
      return;
    }
    if (bans.length === 0) {
      await interaction.editReply({ content: 'No one is banned.' });
      return;
    }
    const shown = bans.slice(0, MAX_SHOWN);
    const lines = shown.map((b) => `• \`${b.userId}\`${b.reason ? ` — ${b.reason}` : ''}`);
    const more = bans.length > MAX_SHOWN ? `\n…and ${bans.length - MAX_SHOWN} more.` : '';
    await interaction.editReply({
      content: `**${bans.length} banned:**\n${lines.join('\n')}${more}`,
    });
  },
};
