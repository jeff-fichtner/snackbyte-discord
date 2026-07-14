/**
 * Adapters mapping live discord.js channels/messages onto the channel-moderation capabilities.
 * Keeps the /purge, /slowmode, /lock, /pin command modules thin and consistent.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import type {
  PurgeChannelView,
  ManageableChannelView,
  PinMessageView,
} from '../moderation/channel.js';

/** Text-based guild channels that support bulk delete / slowmode / lock. */
function isManageableText(channel: GuildTextBasedChannel): boolean {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread ||
    channel.type === ChannelType.GuildVoice
  );
}

export function purgeChannelView(channel: GuildTextBasedChannel): PurgeChannelView {
  return {
    supportsBulk: isManageableText(channel),
    fetchRecent: async (limit) => {
      const messages = await channel.messages.fetch({ limit });
      return [...messages.values()].map((m) => ({
        id: m.id,
        createdTimestamp: m.createdTimestamp,
      }));
    },
    bulkDelete: async (ids, reason) => {
      await channel.bulkDelete(ids);
      void reason; // bulkDelete has no audit-reason parameter; reason is recorded where supported
    },
  };
}

export function manageableChannelView(channel: GuildTextBasedChannel): ManageableChannelView {
  const everyone = channel.guild.roles.everyone;
  return {
    supportsSlowmode: isManageableText(channel) && 'setRateLimitPerUser' in channel,
    supportsLock: isManageableText(channel) && 'permissionOverwrites' in channel,
    setRateLimit: async (seconds, reason) => {
      if ('setRateLimitPerUser' in channel) {
        await channel.setRateLimitPerUser(seconds, reason);
      }
    },
    setLocked: async (locked, reason) => {
      if ('permissionOverwrites' in channel) {
        await channel.permissionOverwrites.edit(
          everyone,
          { SendMessages: locked ? false : null },
          { reason },
        );
      }
    },
  };
}

export function pinMessageView(message: Message): PinMessageView {
  return {
    pin: async () => {
      await message.pin();
    },
    unpin: async () => {
      await message.unpin();
    },
  };
}

/** The native permissions the channel/message commands guard on (informational; gate is via isModerator). */
export const CHANNEL_BOT_PERMISSION = {
  purge: PermissionFlagsBits.ManageMessages,
  pin: PermissionFlagsBits.ManageMessages,
  slowmode: PermissionFlagsBits.ManageChannels,
  lock: PermissionFlagsBits.ManageChannels,
} as const;
