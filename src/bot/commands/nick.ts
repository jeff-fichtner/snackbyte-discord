/**
 * /nick — set or reset your own server nickname. Thin adapter: maps the live interaction onto the
 * setOwnNickname capability and renders the outcome ephemerally. Providing a value sets it; omitting
 * it resets (clears) to the account name. Acts only on the invoking member.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { setOwnNickname, type NicknameMemberView } from '../members/nickname.js';

function memberView(member: GuildMember): NicknameMemberView {
  const me = member.guild.members.me;
  const botHighest = me?.roles.highest.position ?? 0;
  return {
    setNickname: async (value) => {
      await member.setNickname(value);
    },
    botOutranksMember: botHighest > member.roles.highest.position,
    botCanManageNicknames: me?.permissions.has(PermissionFlagsBits.ManageNicknames) ?? false,
  };
}

export const nickCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Set your server nickname, or reset it by leaving it blank.')
    .addStringOption((opt) =>
      opt
        .setName('nickname')
        .setDescription('The nickname to set (leave blank to reset). Max 32 characters.')
        .setRequired(false)
        .setMaxLength(32),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    if (!interaction.inCachedGuild() || !member || !('setNickname' in member)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    const value = interaction.options.getString('nickname') ?? undefined;

    const result = await setOwnNickname(memberView(member as GuildMember), value);

    let content: string;
    switch (result.outcome) {
      case 'set':
        content = `Nickname set to **${value}**.`;
        break;
      case 'cleared':
        content = 'Nickname reset.';
        break;
      default:
        content =
          result.reason === 'invalid-input'
            ? 'That nickname is invalid — it must be 1–32 characters and not only spaces.'
            : "I can't change your nickname — you're above my role, or I'm missing the Manage Nicknames permission.";
    }
    await interaction.editReply({ content });
  },
};
