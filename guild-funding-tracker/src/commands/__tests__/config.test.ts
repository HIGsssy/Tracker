// Unit tests for /funding config command handler.

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
  upsertGuildConfig: vi.fn(),
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

import { handleConfig } from '../config';
import { getGuildConfig, upsertGuildConfig } from '../../services/fundingService';
import { refreshTracker, TrackerError } from '../../services/trackerService';

const mockGetGuildConfig = vi.mocked(getGuildConfig);
const mockUpsertGuildConfig = vi.mocked(upsertGuildConfig);
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
  title?: string | null;
  displayMode?: string | null;
} = {}): ChatInputCommandInteraction {
  const {
    guildId = 'guild-001',
    hasManageGuild = true,
    title = null,
    displayMode = null,
  } = overrides;

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    memberPermissions: {
      has: vi.fn().mockReturnValue(hasManageGuild),
    },
    options: {
      getString: vi.fn().mockImplementation((name: string) => {
        if (name === 'title') return title;
        if (name === 'display_mode') return displayMode;
        return null;
      }),
    },
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
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding config — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
  });
});

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

describe('/funding config — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// View mode (no options)
// ---------------------------------------------------------------------------

describe('/funding config — view mode (no options)', () => {
  it('responds with an embed when no options provided', async () => {
    const interaction = makeInteraction();
    await handleConfig(interaction);
    const calls = vi.mocked(interaction.editReply).mock.calls;
    const embedCall = calls.find(([arg]) =>
      typeof arg === 'object' && arg !== null && 'embeds' in arg,
    );
    expect(embedCall).toBeDefined();
  });

  it('does not call upsertGuildConfig in view mode', async () => {
    const interaction = makeInteraction();
    await handleConfig(interaction);
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('does not call refreshTracker in view mode', async () => {
    const interaction = makeInteraction();
    await handleConfig(interaction);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('responds with not-configured message when no config exists', async () => {
    mockGetGuildConfig.mockReturnValue(null);
    const interaction = makeInteraction();
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not configured'),
    );
  });
});

// ---------------------------------------------------------------------------
// Update mode (with options)
// ---------------------------------------------------------------------------

describe('/funding config — update title', () => {
  it('calls upsertGuildConfig with the new title', async () => {
    const interaction = makeInteraction({ title: 'My Server' });
    await handleConfig(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(
      'guild-001',
      expect.objectContaining({ displayTitle: 'My Server' }),
    );
  });

  it('calls refreshTracker after updating', async () => {
    const interaction = makeInteraction({ title: 'My Server' });
    await handleConfig(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('responds with a success message', async () => {
    const interaction = makeInteraction({ title: 'My Server' });
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Configuration updated'),
    );
  });
});

describe('/funding config — update display_mode', () => {
  it('calls upsertGuildConfig with the new display mode', async () => {
    const interaction = makeInteraction({ displayMode: 'minimal' });
    await handleConfig(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(
      'guild-001',
      expect.objectContaining({ publicDisplayMode: 'minimal' }),
    );
  });

  it('accepts standard display mode', async () => {
    const interaction = makeInteraction({ displayMode: 'standard' });
    await handleConfig(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(
      'guild-001',
      expect.objectContaining({ publicDisplayMode: 'standard' }),
    );
  });
});

describe('/funding config — update both options', () => {
  it('passes both title and display_mode to upsertGuildConfig', async () => {
    const interaction = makeInteraction({ title: 'New Title', displayMode: 'minimal' });
    await handleConfig(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith('guild-001', {
      displayTitle: 'New Title',
      publicDisplayMode: 'minimal',
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('/funding config — error handling', () => {
  it('surfaces TrackerError message to user', async () => {
    const MockTrackerError = TrackerError;
    mockRefreshTracker.mockRejectedValueOnce(
      new MockTrackerError('Tracker channel no longer exists.'),
    );
    const interaction = makeInteraction({ title: 'Test' });
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Tracker channel no longer exists.'),
    );
  });

  it('responds with generic error for unknown failures', async () => {
    mockRefreshTracker.mockRejectedValueOnce(new Error('Unexpected failure'));
    const interaction = makeInteraction({ title: 'Test' });
    await handleConfig(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });
});
