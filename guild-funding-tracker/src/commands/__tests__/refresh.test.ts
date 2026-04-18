// Unit tests for /funding refresh command handler.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  getGuildConfig: vi.fn(),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

vi.mock('../../services/trackerService', () => ({
  refreshTracker: vi.fn().mockResolvedValue({ action: 'edited' }),
  TrackerError: class TrackerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TrackerError';
    }
  },
}));

import { handleRefresh } from '../refresh';
import { getGuildConfig } from '../../services/fundingService';
import { refreshTracker, TrackerError } from '../../services/trackerService';

const mockGetGuildConfig = vi.mocked(getGuildConfig);
const mockRefreshTracker = vi.mocked(refreshTracker);

const BASE_CONFIG = {
  id: 1,
  guildId: 'guild-001',
  enabled: true,
  trackerChannelId: 'ch-001',
  trackerMessageId: 'msg-001',
  hourlyCost: 0.06,
  displayTitle: 'Server Funding',
  publicDisplayMode: 'standard' as const,
  hidePublicDollarValues: true,
  adminRoleId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-15T12:00:00.000Z',
};

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
} = {}): ChatInputCommandInteraction {
  const { guildId = 'guild-001', hasManageGuild = true } = overrides;

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    memberPermissions: {
      has: vi.fn().mockReturnValue(hasManageGuild),
    },
    options: {},
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: true,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGuildConfig.mockReturnValue(BASE_CONFIG as ReturnType<typeof getGuildConfig>);
  mockRefreshTracker.mockResolvedValue({ action: 'edited' });
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding refresh — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

describe('/funding refresh — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Successful refresh outcomes
// ---------------------------------------------------------------------------

describe('/funding refresh — edited response', () => {
  it('responds with "Tracker refreshed." when action is edited', async () => {
    mockRefreshTracker.mockResolvedValue({ action: 'edited' });
    const interaction = makeInteraction();
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith('Tracker refreshed.');
  });
});

describe('/funding refresh — reposted response', () => {
  it('responds with re-post message including channel mention when action is reposted', async () => {
    mockRefreshTracker.mockResolvedValue({ action: 'reposted' });
    const interaction = makeInteraction();
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('<#ch-001>'),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('re-posted'),
    );
  });

  it('falls back to "Tracker refreshed." when reposted but channel ID is not in config', async () => {
    mockGetGuildConfig.mockReturnValue({
      ...BASE_CONFIG,
      trackerChannelId: null,
    } as ReturnType<typeof getGuildConfig>);
    mockRefreshTracker.mockResolvedValue({ action: 'reposted' });
    const interaction = makeInteraction();
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith('Tracker refreshed.');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('/funding refresh — error handling', () => {
  it('surfaces TrackerError message to user', async () => {
    const MockTrackerError = TrackerError;
    mockRefreshTracker.mockRejectedValueOnce(
      new MockTrackerError('Tracker channel no longer exists. Run /funding setup to reconfigure.'),
    );
    const interaction = makeInteraction();
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Tracker channel no longer exists.'),
    );
  });

  it('responds with generic error for unknown failures', async () => {
    mockRefreshTracker.mockRejectedValueOnce(new Error('Unexpected failure'));
    const interaction = makeInteraction();
    await handleRefresh(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });
});
