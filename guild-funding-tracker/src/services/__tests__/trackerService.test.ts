// Unit tests for trackerService.refreshTracker.
// Discord client, fundingService, and calculationService are all mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType } from 'discord.js';

// Mock config/env so the module resolves without process.exit.
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

// Mock db/client with an in-memory DB so upsertGuildConfig/getGuildConfig calls in the
// service itself work. The key state under test (trackerMessageId) is observed via the db.
vi.mock('../../db/client', async () => {
  const { createTestDb } = await import('../../db/testDb');
  return { db: createTestDb() };
});

// Mock fundingService — we control what getGuildConfig and getMonthTotal return.
vi.mock('../fundingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fundingService')>();
  return {
    ...actual,
    getGuildConfig: vi.fn(),
    getMonthTotal: vi.fn().mockReturnValue(0),
  };
});

import { db } from '../../db/client';
import { guildTrackerConfig } from '../../db/schema';
import { getGuildConfig, getMonthTotal } from '../fundingService';
import { refreshTracker, TrackerError } from '../trackerService';
import type { Client } from 'discord.js';

const mockGetGuildConfig = vi.mocked(getGuildConfig);
const mockGetMonthTotal = vi.mocked(getMonthTotal);

const GUILD_ID = 'guild-test-1';
const CHANNEL_ID = 'ch-test-1';
const MESSAGE_ID = 'msg-test-1';

// Helpers to build minimal mock objects.

function makeConfig(overrides: Partial<{
  enabled: boolean;
  trackerChannelId: string | null;
  trackerMessageId: string | null;
}> = {}) {
  return {
    id: 1,
    guildId: GUILD_ID,
    enabled: true,
    trackerChannelId: CHANNEL_ID,
    trackerMessageId: null,
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

function makeClient(channelOverride?: unknown): Client {
  const mockEdit = vi.fn().mockResolvedValue(undefined);
  const mockSend = vi.fn().mockResolvedValue({ id: 'new-msg-id' });

  const channel = channelOverride ?? {
    type: ChannelType.GuildText,
    messages: { edit: mockEdit },
    send: mockSend,
  };

  return {
    channels: {
      fetch: vi.fn().mockResolvedValue(channel),
    },
  } as unknown as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure the config table has the guild row so db UPDATE calls in trackerService work.
  db.delete(guildTrackerConfig).run();
  db.insert(guildTrackerConfig).values({
    guildId: GUILD_ID,
    enabled: true,
    trackerChannelId: CHANNEL_ID,
    trackerMessageId: null,
    hourlyCost: 0.06,
    displayTitle: 'Server Funding',
    publicDisplayMode: 'standard',
    hidePublicDollarValues: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }).run();
});

describe('refreshTracker — error cases', () => {
  it('throws TrackerError when guild config is missing', async () => {
    mockGetGuildConfig.mockReturnValue(null);
    const client = makeClient();
    await expect(refreshTracker(GUILD_ID, client)).rejects.toThrow(TrackerError);
  });

  it('throws TrackerError when guild tracker is disabled', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ enabled: false }));
    const client = makeClient();
    await expect(refreshTracker(GUILD_ID, client)).rejects.toThrow(TrackerError);
  });

  it('throws TrackerError when no tracker channel is configured', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerChannelId: null }));
    const client = makeClient();
    await expect(refreshTracker(GUILD_ID, client)).rejects.toThrow(TrackerError);
  });
});

describe('refreshTracker — posts new message when no tracker_message_id', () => {
  it('calls channel.send and stores the returned message ID in DB', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: null }));
    mockGetMonthTotal.mockReturnValue(0);

    const mockSend = vi.fn().mockResolvedValue({ id: 'brand-new-msg' });
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: vi.fn() },
      send: mockSend,
    };
    const client = makeClient(channel);

    await refreshTracker(GUILD_ID, client);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));

    const row = db.select().from(guildTrackerConfig).limit(1).get();
    expect(row?.trackerMessageId).toBe('brand-new-msg');
  });

  it('updates updated_at in DB after posting new message', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: null }));
    const client = makeClient();

    const before = db.select().from(guildTrackerConfig).limit(1).get();
    await refreshTracker(GUILD_ID, client);
    const after = db.select().from(guildTrackerConfig).limit(1).get();

    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });
});

describe('refreshTracker — edits existing message when tracker_message_id present', () => {
  it('calls channel.messages.edit with the stored message ID', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));

    const mockEdit = vi.fn().mockResolvedValue(undefined);
    const mockSend = vi.fn();
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: mockSend,
    };
    const client = makeClient(channel);

    await refreshTracker(GUILD_ID, client);

    expect(mockEdit).toHaveBeenCalledOnce();
    expect(mockEdit).toHaveBeenCalledWith(MESSAGE_ID, expect.objectContaining({ embeds: expect.any(Array) }));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('updates updated_at in DB after a successful edit', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));
    const client = makeClient();

    const before = db.select().from(guildTrackerConfig).limit(1).get();
    await refreshTracker(GUILD_ID, client);
    const after = db.select().from(guildTrackerConfig).limit(1).get();

    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });
});

describe('refreshTracker — falls back to new post on Unknown Message', () => {
  it('calls channel.send when edit fails with Discord error 10008', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));

    const unknownMessageError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const mockEdit = vi.fn().mockRejectedValue(unknownMessageError);
    const mockSend = vi.fn().mockResolvedValue({ id: 'recovered-msg-id' });
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: mockSend,
    };
    const client = makeClient(channel);

    await refreshTracker(GUILD_ID, client);

    expect(mockEdit).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();

    const row = db.select().from(guildTrackerConfig).limit(1).get();
    expect(row?.trackerMessageId).toBe('recovered-msg-id');
  });

  it('calls channel.send when edit fails with Discord error 10003', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));

    const unknownChannelError = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const mockEdit = vi.fn().mockRejectedValue(unknownChannelError);
    const mockSend = vi.fn().mockResolvedValue({ id: 'recovered-from-channel-error' });
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: mockSend,
    };
    const client = makeClient(channel);

    await refreshTracker(GUILD_ID, client);

    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('re-throws non-Discord errors during edit', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));

    const permissionsError = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    const mockEdit = vi.fn().mockRejectedValue(permissionsError);
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: vi.fn(),
    };
    const client = makeClient(channel);

    await expect(refreshTracker(GUILD_ID, client)).rejects.toMatchObject({ code: 50013 });
  });
});

describe('refreshTracker — outer channel fetch fails with 10003', () => {
  it('clears trackerChannelId and trackerMessageId in DB and throws TrackerError', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));

    // Seed DB with non-null channel and message IDs so we can assert they are cleared.
    db.update(guildTrackerConfig)
      .set({ trackerChannelId: CHANNEL_ID, trackerMessageId: MESSAGE_ID })
      .run();

    const unknownChannelError = Object.assign(new Error('Unknown Channel'), { code: 10003 });
    const client = {
      channels: {
        fetch: vi.fn().mockRejectedValue(unknownChannelError),
      },
    } as unknown as Client;

    await expect(refreshTracker(GUILD_ID, client)).rejects.toThrow(TrackerError);

    const row = db.select().from(guildTrackerConfig).limit(1).get();
    expect(row?.trackerChannelId).toBeNull();
    expect(row?.trackerMessageId).toBeNull();
  });
});

describe('refreshTracker — new message ID is stored in DB', () => {
  it('stores new message ID returned from channel.send', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: null }));
    const mockSend = vi.fn().mockResolvedValue({ id: 'stored-msg-id' });
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: vi.fn() },
      send: mockSend,
    };
    const client = makeClient(channel);

    await refreshTracker(GUILD_ID, client);

    const row = db.select().from(guildTrackerConfig).limit(1).get();
    expect(row?.trackerMessageId).toBe('stored-msg-id');
  });
});

// ---------------------------------------------------------------------------
// refreshTracker — return value
// ---------------------------------------------------------------------------

describe('refreshTracker — return value', () => {
  it('returns { action: "edited" } when existing message was edited', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));
    const client = makeClient();
    const result = await refreshTracker(GUILD_ID, client);
    expect(result.action).toBe('edited');
  });

  it('returns { action: "reposted" } when no message ID existed (new post)', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: null }));
    const client = makeClient();
    const result = await refreshTracker(GUILD_ID, client);
    expect(result.action).toBe('reposted');
  });

  it('returns { action: "reposted" } when existing message was gone (10008 fallback)', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: MESSAGE_ID }));
    const unknownMessageError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: vi.fn().mockRejectedValue(unknownMessageError) },
      send: vi.fn().mockResolvedValue({ id: 'fallback-msg' }),
    };
    const client = makeClient(channel);
    const result = await refreshTracker(GUILD_ID, client);
    expect(result.action).toBe('reposted');
  });
});

// ---------------------------------------------------------------------------
// refreshIfStale
// ---------------------------------------------------------------------------

import { refreshIfStale } from '../trackerService';

describe('refreshIfStale — returns early guards', () => {
  it('returns early when config is null', async () => {
    mockGetGuildConfig.mockReturnValue(null);
    const client = makeClient();
    await expect(refreshIfStale(GUILD_ID, client)).resolves.toBeUndefined();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when tracker is disabled', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ enabled: false }));
    const client = makeClient();
    await expect(refreshIfStale(GUILD_ID, client)).resolves.toBeUndefined();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when no tracker channel', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerChannelId: null }));
    const client = makeClient();
    await expect(refreshIfStale(GUILD_ID, client)).resolves.toBeUndefined();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when no tracker message ID', async () => {
    mockGetGuildConfig.mockReturnValue(makeConfig({ trackerMessageId: null }));
    const client = makeClient();
    await expect(refreshIfStale(GUILD_ID, client)).resolves.toBeUndefined();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when embed is within the freshness threshold', async () => {
    // Updated 1 hour ago; threshold is 6 hours in the mocked config.
    const freshUpdatedAt = new Date(Date.now() - 1 * 3_600_000).toISOString();
    mockGetGuildConfig.mockReturnValue({
      ...makeConfig({ trackerMessageId: MESSAGE_ID }),
      updatedAt: freshUpdatedAt,
    });
    const client = makeClient();
    await refreshIfStale(GUILD_ID, client);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});

describe('refreshIfStale — stale embed triggers refresh', () => {
  it('calls refreshTracker (via channel.messages.edit) when embed is stale', async () => {
    // Updated 7 hours ago; threshold is 6 hours.
    const staleUpdatedAt = new Date(Date.now() - 7 * 3_600_000).toISOString();
    mockGetGuildConfig.mockReturnValue({
      ...makeConfig({ trackerMessageId: MESSAGE_ID }),
      updatedAt: staleUpdatedAt,
    });
    const mockEdit = vi.fn().mockResolvedValue(undefined);
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: vi.fn(),
    };
    const client = makeClient(channel);

    await refreshIfStale(GUILD_ID, client);

    // refreshTracker ran and edited the existing message.
    expect(mockEdit).toHaveBeenCalledOnce();
  });

  it('does not call channel.messages.edit when embed is not yet stale', async () => {
    const freshUpdatedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    mockGetGuildConfig.mockReturnValue({
      ...makeConfig({ trackerMessageId: MESSAGE_ID }),
      updatedAt: freshUpdatedAt,
    });
    const mockEdit = vi.fn();
    const channel = {
      type: ChannelType.GuildText,
      messages: { edit: mockEdit },
      send: vi.fn(),
    };
    const client = makeClient(channel);

    await refreshIfStale(GUILD_ID, client);

    expect(mockEdit).not.toHaveBeenCalled();
  });
});
