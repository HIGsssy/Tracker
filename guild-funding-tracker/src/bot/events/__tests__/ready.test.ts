// Unit tests for bot/events/ready.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { Client } from 'discord.js';

vi.mock('../../../config/env', () => ({
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

vi.mock('../../../db/client', async () => {
  const { createTestDb } = await import('../../../db/testDb');
  return { db: createTestDb() };
});

vi.mock('../../../services/fundingService', () => ({
  getAllEnabledConfigs: vi.fn(),
  upsertGuildConfig: vi.fn(),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

vi.mock('../../../services/trackerService', () => ({
  refreshIfStale: vi.fn().mockResolvedValue(undefined),
  TrackerError: class TrackerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TrackerError';
    }
  },
}));

vi.mock('../../../services/archiveService', () => ({
  archiveMonth: vi.fn(),
  getMonthArchive: vi.fn().mockReturnValue({ id: 1, monthKey: '2026-03' }), // default: archive exists
}));

vi.mock('../../../services/calculationService', () => ({
  getPreviousMonthKey: vi.fn().mockReturnValue('2026-03'),
}));

import { handleReady } from '../ready';
import { getAllEnabledConfigs, upsertGuildConfig } from '../../../services/fundingService';
import { refreshIfStale } from '../../../services/trackerService';
import { archiveMonth, getMonthArchive } from '../../../services/archiveService';
import { getPreviousMonthKey } from '../../../services/calculationService';

const mockGetAllEnabledConfigs = vi.mocked(getAllEnabledConfigs);
const mockUpsertGuildConfig = vi.mocked(upsertGuildConfig);
const mockRefreshIfStale = vi.mocked(refreshIfStale);
const mockArchiveMonth = vi.mocked(archiveMonth);
const mockGetMonthArchive = vi.mocked(getMonthArchive);
const mockGetPreviousMonthKey = vi.mocked(getPreviousMonthKey);

const GUILD_ID = 'guild-001';
const CHANNEL_ID = 'ch-001';
const MESSAGE_ID = 'msg-001';

function makeConfig(overrides: Partial<{
  guildId: string;
  enabled: boolean;
  trackerChannelId: string | null;
  trackerMessageId: string | null;
}> = {}) {
  return {
    id: 1,
    guildId: GUILD_ID,
    enabled: true,
    trackerChannelId: CHANNEL_ID,
    trackerMessageId: MESSAGE_ID,
    hourlyCost: 0.06,
    displayTitle: 'Server Funding',
    publicDisplayMode: 'standard' as const,
    hidePublicDollarValues: true,
    adminRoleId: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClient(options: {
  channelFetchResult?: unknown;
  channelFetchError?: unknown;
  messageFetchResult?: unknown;
  messageFetchError?: unknown;
} = {}): Client<true> {
  const messageFetch = options.messageFetchError
    ? vi.fn().mockRejectedValue(options.messageFetchError)
    : vi.fn().mockResolvedValue(options.messageFetchResult ?? { id: MESSAGE_ID });

  const channel = options.channelFetchResult ?? {
    type: ChannelType.GuildText,
    messages: { fetch: messageFetch },
  };

  const channelsFetch = options.channelFetchError
    ? vi.fn().mockRejectedValue(options.channelFetchError)
    : vi.fn().mockResolvedValue(channel);

  return {
    user: { tag: 'TestBot#0000' },
    guilds: {
      cache: {
        size: 1,
        map: vi.fn().mockReturnValue(['Test Guild']),
      },
    },
    channels: {
      fetch: channelsFetch,
    },
  } as unknown as Client<true>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllEnabledConfigs.mockReturnValue([]);
  // Default: previous month archive already exists — skips recovery.
  mockGetMonthArchive.mockReturnValue({ id: 1, monthKey: '2026-03' } as ReturnType<typeof getMonthArchive>);
  mockGetPreviousMonthKey.mockReturnValue('2026-03');
});

// ---------------------------------------------------------------------------
// Empty config list
// ---------------------------------------------------------------------------

describe('handleReady — no enabled configs', () => {
  it('completes without errors when no enabled configs exist', async () => {
    const client = makeClient();
    await expect(handleReady(client)).resolves.not.toThrow();
  });

  it('does not call refreshIfStale when no configs exist', async () => {
    const client = makeClient();
    await handleReady(client);
    expect(mockRefreshIfStale).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Valid channel and message
// ---------------------------------------------------------------------------

describe('handleReady — valid channel and message', () => {
  it('calls refreshIfStale for a guild with valid channel and message', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const client = makeClient();
    await handleReady(client);
    expect(mockRefreshIfStale).toHaveBeenCalledOnce();
    expect(mockRefreshIfStale).toHaveBeenCalledWith(GUILD_ID, client);
  });

  it('does not call upsertGuildConfig when channel and message are valid', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const client = makeClient();
    await handleReady(client);
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing message (10008)
// ---------------------------------------------------------------------------

describe('handleReady — missing message (10008)', () => {
  it('clears only the message ID when message fetch fails with 10008', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const msgError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const client = makeClient({ messageFetchError: msgError });
    await handleReady(client);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(GUILD_ID, { trackerMessageId: null });
  });

  it('does not clear channel ID when only the message is missing', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const msgError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const client = makeClient({ messageFetchError: msgError });
    await handleReady(client);
    const calls = mockUpsertGuildConfig.mock.calls;
    for (const [, params] of calls) {
      expect(params).not.toHaveProperty('trackerChannelId');
    }
  });

  it('does not crash when tracker message is missing', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const msgError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const client = makeClient({ messageFetchError: msgError });
    await expect(handleReady(client)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing channel (10003)
// ---------------------------------------------------------------------------

describe('handleReady — missing channel (10003)', () => {
  it('clears both channel and message IDs when channel fetch fails with 10003', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const chError = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = makeClient({ channelFetchError: chError });
    await handleReady(client);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith(GUILD_ID, {
      trackerChannelId: null,
      trackerMessageId: null,
    });
  });

  it('does not call refreshIfStale when channel is missing', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const chError = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = makeClient({ channelFetchError: chError });
    await handleReady(client);
    expect(mockRefreshIfStale).not.toHaveBeenCalled();
  });

  it('does not crash when tracker channel is missing', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    const chError = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = makeClient({ channelFetchError: chError });
    await expect(handleReady(client)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Config with no channel set
// ---------------------------------------------------------------------------

describe('handleReady — config with no tracker channel', () => {
  it('skips validation when no tracker channel is configured', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig({ trackerChannelId: null })]);
    const client = makeClient();
    await handleReady(client);
    expect(vi.mocked(client.channels.fetch)).not.toHaveBeenCalled();
    expect(mockRefreshIfStale).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Per-guild isolation
// ---------------------------------------------------------------------------

describe('handleReady — per-guild error isolation', () => {
  it('continues processing remaining guilds when one throws unexpectedly', async () => {
    const guild1 = makeConfig({ guildId: 'guild-001' });
    const guild2 = makeConfig({ guildId: 'guild-002' });
    mockGetAllEnabledConfigs.mockReturnValue([guild1, guild2]);

    // First guild's refreshIfStale throws; second should still be called.
    mockRefreshIfStale
      .mockRejectedValueOnce(new Error('Unexpected error for guild-001'))
      .mockResolvedValueOnce(undefined);

    const client = makeClient();
    await expect(handleReady(client)).resolves.not.toThrow();
    expect(mockRefreshIfStale).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Missed-archive recovery
// ---------------------------------------------------------------------------

describe('handleReady — missed archive recovery', () => {
  it('calls archiveMonth when no previous-month archive exists', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    mockGetMonthArchive.mockReturnValue(null); // no existing archive
    const client = makeClient();
    await handleReady(client);
    expect(mockArchiveMonth).toHaveBeenCalledWith(GUILD_ID, '2026-03');
  });

  it('does not call archiveMonth when the previous-month archive already exists', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    // default mock returns a non-null archive — archive already exists
    const client = makeClient();
    await handleReady(client);
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });

  it('archive recovery runs even when trackerChannelId is null', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig({ trackerChannelId: null })]);
    mockGetMonthArchive.mockReturnValue(null);
    const client = makeClient();
    await handleReady(client);
    expect(mockArchiveMonth).toHaveBeenCalledWith(GUILD_ID, '2026-03');
  });

  it('logs and continues when archiveMonth throws for a guild', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    mockGetMonthArchive.mockReturnValue(null);
    mockArchiveMonth.mockImplementationOnce(() => {
      throw new Error('Archive DB error');
    });
    const client = makeClient();
    // Should not throw — per-guild errors are caught and logged
    await expect(handleReady(client)).resolves.not.toThrow();
  });

  it('archive recovery failure does not prevent stale-refresh from running', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([makeConfig()]);
    mockGetMonthArchive.mockReturnValue(null);
    mockArchiveMonth.mockImplementationOnce(() => {
      throw new Error('Archive DB error');
    });
    const client = makeClient();
    await handleReady(client);
    // refreshIfStale should still be called despite the archive failure
    expect(mockRefreshIfStale).toHaveBeenCalledWith(GUILD_ID, client);
  });
});
