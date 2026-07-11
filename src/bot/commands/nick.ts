/**
 * /nick — set or reset a server nickname. With no `member` (or yourself) it changes your OWN
 * nickname (the self-service path). With a different `member` it changes THAT member's nickname —
 * the moderation path, the piece Discord's built-in /nick can't do — gated by the invoker's native
 * Manage Nicknames permission. Thin adapter: maps the live interaction onto the setOwnNickname /
 * setMemberNickname capability and renders the outcome ephemerally.
 */
import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { SlashCommand } from './types.js';
import { setOwnNickname, setMemberNickname, type NicknameMemberView } from '../members/nickname.js';
import { isModerator } from '../moderation/standing.js';

/** Build the capability view for a target member — bot-position is relative to that member. */
function memberView(target: GuildMember): NicknameMemberView {
  const me = target.guild.members.me;
  const botHighest = me?.roles.highest.position ?? 0;
  return {
    setNickname: async (value) => {
      await target.setNickname(value);
    },
    botOutranksMember: botHighest > target.roles.highest.position,
    botCanManageNicknames: me?.permissions.has(PermissionFlagsBits.ManageNicknames) ?? false,
  };
}

export const nickCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Set a server nickname, or reset it by leaving it blank.')
    .addStringOption((opt) =>
      opt
        .setName('nickname')
        .setDescription('The nickname to set (leave blank to reset). Max 32 characters.')
        .setRequired(false)
        .setMaxLength(32),
    )
    .addUserOption((opt) =>
      opt
        .setName('member')
        .setDescription('Whose nickname to change (moderators only; defaults to yourself).')
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const invoker = interaction.member;
    if (!interaction.inCachedGuild() || !invoker || !('setNickname' in invoker)) {
      await interaction.editReply({ content: 'This command only works in a server.' });
      return;
    }
    const value = interaction.options.getString('nickname') ?? undefined;
    const targetUser = interaction.options.getUser('member');
    const invokerMember = invoker as GuildMember;

    // Self path: no member, or the invoker named themselves. Unchanged 004 behavior.
    const isSelf = !targetUser || targetUser.id === invokerMember.id;
    if (isSelf) {
      const result = await setOwnNickname(memberView(invokerMember), value);
      await interaction.editReply({ content: selfMessage(result, value) });
      return;
    }

    // Cross-member path: requires the native Manage Nicknames permission.
    if (!isModerator(invokerMember.permissions, 'nickname')) {
      await interaction.editReply({
        content: 'You can only change your own nickname.',
      });
      return;
    }
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: "That member isn't in this server." });
      return;
    }
    const result = await setMemberNickname(memberView(target), value);
    await interaction.editReply({ content: memberMessage(result, value, target.toString()) });
  },
};

function selfMessage(
  result: Awaited<ReturnType<typeof setOwnNickname>>,
  value: string | undefined,
): string {
  switch (result.outcome) {
    case 'set':
      return `Nickname set to **${value}**.`;
    case 'cleared':
      return 'Nickname reset.';
    default:
      return result.reason === 'invalid-input'
        ? 'That nickname is invalid — it must be 1–32 characters and not only spaces.'
        : "I can't change your nickname — you're above my role, or I'm missing the Manage Nicknames permission.";
  }
}

function memberMessage(
  result: Awaited<ReturnType<typeof setMemberNickname>>,
  value: string | undefined,
  mention: string,
): string {
  switch (result.outcome) {
    case 'set':
      return `Set ${mention}'s nickname to **${value}**.`;
    case 'cleared':
      return `Reset ${mention}'s nickname.`;
    default:
      return result.reason === 'invalid-input'
        ? 'That nickname is invalid — it must be 1–32 characters and not only spaces.'
        : `I can't change ${mention}'s nickname — they're above my role, or I'm missing the Manage Nicknames permission.`;
  }
}
