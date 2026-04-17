// Unit tests for /funding setup command handler.
// All service calls and Discord interactions are mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

vi.mock('../../config/env', () => ({
  config: {
    DEFAULT_HOURLY_COST: 0.06,
    DISCORD_TOKEN: 'test',
    DISCORD_CLIENT_ID: '000',
    DATABASE_PATH: ':memory:',
    STALE_EMBED_THRESHOLD_HOURS: 6,
    LOG_LEVEL: 'error',
    NODE_ENV: 'development',
  },
}));

vi.mock('../../db/client', async () => {
  const { createTestDb } = await import('../../db/testDb');
  return { db: createTestDb() };
});

vi.mock('../../services/fundingService', () => ({
  upsertGuildConfig: vi.fn(),
  getGuildConfig: vi.fn().mockReturnValue(null),
  getMonthTotal: vi.fn().mockReturnValue(0),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

vi.mock('../../services/trackerService', () => ({
  refreshTracker: vi.fn().mockResolvedValue(undefined),
  TrackerError: class TrackerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TrackerError';
    }
  },
}));

import { handleSetup } from '../setup';
import { upsertGuildConfig } from '../../services/fundingService';
import { refreshTracker } from '../../services/trackerService';

const mockUpsertGuildConfig = vi.mocked(upsertGuildConfig);
const mockRefreshTracker = vi.mocked(refreshTracker);

// Builds a minimal mock ChatInputCommandInteraction.
function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
  channelType?: ChannelType;
  channelId?: string;
  canSendInChannel?: boolean;
  hourlyCost?: number | null;
  title?: string | null;
} = {}): ChatInputCommandInteraction {
  const {
    guildId = 'guild-001',
    hasManageGuild = true,
    channelType = ChannelType.GuildText,
    channelId = 'ch-001',
    canSendInChannel = true,
    hourlyCost = null,
    title = null,
  } = overrides;

  const perms = canSendInChannel
    ? { has: vi.fn().mockReturnValue(true) }
    : { has: vi.fn().mockReturnValue(false) };

  const channel = {
    id: channelId,
    type: channelType,
    permissionsFor: vi.fn().mockReturnValue(perms),
  };

  const memberPerms = hasManageGuild
    ? { has: vi.fn().mockReturnValue(true) }
    : { has: vi.fn().mockReturnValue(false) };

  const guild = {
    id: guildId,
    members: {
      me: { id: 'bot-user-id' },
    },
  };

  return {
    guildId,
    guild,
    memberPermissions: memberPerms,
    options: {
      getChannel: vi.fn().mockReturnValue(channel),
      getNumber: vi.fn().mockReturnValue(hourlyCost),
      getString: vi.fn().mockReturnValue(title),
      getSubcommand: vi.fn().mockReturnValue('setup'),
    },
    client: { channels: { fetch: vi.fn() } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/funding setup — permission rejection', () => {
  it('rejects with ephemeral message when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('rejects when called outside a guild (no guildId)', async () => {
    const interaction = makeInteraction({ guildId: null });
    // Override to have guild be null too
    (interaction as unknown as Record<string, unknown>)['guild'] = null;
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/funding setup — channel validation', () => {
  it('rejects when the selected channel is not a text channel', async () => {
    const interaction = makeInteraction({ channelType: ChannelType.GuildVoice });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('must be a text channel'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects when bot lacks SendMessages/EmbedLinks in the channel', async () => {
    const interaction = makeInteraction({ canSendInChannel: false });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("don't have permission"),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/funding setup — hourly_cost validation', () => {
  it('rejects hourly_cost below minimum', async () => {
    const interaction = makeInteraction({ hourlyCost: 0.0009 });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Hourly cost must be between'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects hourly_cost above maximum', async () => {
    const interaction = makeInteraction({ hourlyCost: 1000.01 });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Hourly cost must be between'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('accepts hourly_cost at the minimum bound', async () => {
    const interaction = makeInteraction({ hourlyCost: 0.001 });
    await handleSetup(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalled();
  });

  it('accepts hourly_cost at the maximum bound', async () => {
    const interaction = makeInteraction({ hourlyCost: 1000 });
    await handleSetup(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalled();
  });
});

describe('/funding setup — successful path', () => {
  it('calls upsertGuildConfig with correct params', async () => {
    const interaction = makeInteraction({ channelId: 'ch-test', hourlyCost: 0.08, title: 'My Guild' });
    await handleSetup(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(
      'guild-001',
      expect.objectContaining({
        enabled: true,
        trackerChannelId: 'ch-test',
        hourlyCost: 0.08,
        displayTitle: 'My Guild',
      }),
    );
  });

  it('calls upsertGuildConfig without optional fields when not provided', async () => {
    const interaction = makeInteraction({ hourlyCost: null, title: null });
    await handleSetup(interaction);
    const callArg = mockUpsertGuildConfig.mock.calls[0]![1];
    expect(callArg).not.toHaveProperty('hourlyCost');
    expect(callArg).not.toHaveProperty('displayTitle');
  });

  it('calls refreshTracker after upsert', async () => {
    const interaction = makeInteraction();
    await handleSetup(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('responds with success message mentioning the channel', async () => {
    const interaction = makeInteraction({ channelId: 'ch-123' });
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('<#ch-123>'),
    );
  });
});

describe('/funding setup — error handling', () => {
  it('responds with user-safe message on unexpected error', async () => {
    mockRefreshTracker.mockRejectedValueOnce(new Error('Unexpected Discord outage'));
    const interaction = makeInteraction();
    await handleSetup(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });

  it('does not expose error details to the user', async () => {
    mockRefreshTracker.mockRejectedValueOnce(new Error('Internal stack trace details'));
    const interaction = makeInteraction();
    await handleSetup(interaction);
    const reply = vi.mocked(interaction.editReply).mock.calls[0]?.[0];
    expect(reply).not.toContain('Internal stack trace details');
  });
});
