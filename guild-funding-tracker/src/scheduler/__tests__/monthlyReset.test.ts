// Unit tests for the monthly reset scheduler.
// Tests focus on callback behavior. setTimeout scheduling is not directly tested.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../../services/calculationService', () => ({
  getPreviousMonthKey: vi.fn().mockReturnValue('2026-03'),
}));

vi.mock('../../services/archiveService', () => ({
  archiveAllGuildsForMonth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/fundingService', () => ({
  getAllEnabledConfigs: vi.fn().mockReturnValue([]),
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

import { msUntilNextMonthlyReset, runMonthlyReset } from '../monthlyReset';
import { archiveAllGuildsForMonth } from '../../services/archiveService';
import { getAllEnabledConfigs } from '../../services/fundingService';
import { refreshTracker } from '../../services/trackerService';
import { getPreviousMonthKey } from '../../services/calculationService';
import type { Client } from 'discord.js';

const mockArchiveAllGuildsForMonth = vi.mocked(archiveAllGuildsForMonth);
const mockGetAllEnabledConfigs = vi.mocked(getAllEnabledConfigs);
const mockRefreshTracker = vi.mocked(refreshTracker);
const mockGetPreviousMonthKey = vi.mocked(getPreviousMonthKey);

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

function makeClient(): Client {
  return {} as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPreviousMonthKey.mockReturnValue('2026-03');
  mockArchiveAllGuildsForMonth.mockResolvedValue(undefined);
  mockGetAllEnabledConfigs.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// msUntilNextMonthlyReset
// ---------------------------------------------------------------------------

describe('msUntilNextMonthlyReset', () => {
  it('returns a positive number for a mid-month date', () => {
    const midApril = new Date('2026-04-15T12:00:00.000Z');
    const ms = msUntilNextMonthlyReset(midApril);
    expect(ms).toBeGreaterThan(0);
  });

  it('targets 00:01 UTC on the 1st of the next month', () => {
    const midApril = new Date('2026-04-15T12:00:00.000Z');
    const ms = msUntilNextMonthlyReset(midApril);
    const target = new Date(midApril.getTime() + ms);
    expect(target.getUTCDate()).toBe(1);
    expect(target.getUTCHours()).toBe(0);
    expect(target.getUTCMinutes()).toBe(1);
    expect(target.getUTCSeconds()).toBe(0);
    expect(target.getUTCMonth()).toBe(4); // May = 4 (0-indexed)
  });

  it('handles December correctly (rolls to January of next year)', () => {
    const midDecember = new Date('2025-12-15T12:00:00.000Z');
    const ms = msUntilNextMonthlyReset(midDecember);
    const target = new Date(midDecember.getTime() + ms);
    expect(target.getUTCFullYear()).toBe(2026);
    expect(target.getUTCMonth()).toBe(0); // January
    expect(target.getUTCDate()).toBe(1);
  });

  it('returns at least 0 even if called exactly at the target time', () => {
    // Exactly at 00:01 UTC on the 1st — the next reset is one month later
    const atReset = new Date('2026-05-01T00:01:00.000Z');
    const ms = msUntilNextMonthlyReset(atReset);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runMonthlyReset
// ---------------------------------------------------------------------------

describe('runMonthlyReset — archiving', () => {
  it('calls archiveAllGuildsForMonth with the previous month key', async () => {
    mockGetPreviousMonthKey.mockReturnValue('2026-03');
    const client = makeClient();
    await runMonthlyReset(client);
    expect(mockArchiveAllGuildsForMonth).toHaveBeenCalledWith('2026-03');
  });

  it('calls archiveAllGuildsForMonth exactly once', async () => {
    const client = makeClient();
    await runMonthlyReset(client);
    expect(mockArchiveAllGuildsForMonth).toHaveBeenCalledTimes(1);
  });
});

describe('runMonthlyReset — tracker refresh', () => {
  it('calls refreshTracker for guilds with a tracker channel', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([BASE_CONFIG]);
    const client = makeClient();
    await runMonthlyReset(client);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', client);
  });

  it('does not call refreshTracker for guilds without a tracker channel', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([{ ...BASE_CONFIG, trackerChannelId: null }]);
    const client = makeClient();
    await runMonthlyReset(client);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('continues refreshing remaining guilds when one refresh fails', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([
      { ...BASE_CONFIG, guildId: 'guild-001' },
      { ...BASE_CONFIG, guildId: 'guild-002', id: 2 },
    ]);
    mockRefreshTracker
      .mockRejectedValueOnce(new Error('Discord error for guild-001'))
      .mockResolvedValueOnce({ action: 'edited' });

    const client = makeClient();
    await expect(runMonthlyReset(client)).resolves.not.toThrow();
    expect(mockRefreshTracker).toHaveBeenCalledTimes(2);
  });

  it('propagates archiveAllGuildsForMonth errors to the caller', async () => {
    // runMonthlyReset propagates the error (caller handles it in startMonthlyResetScheduler)
    mockArchiveAllGuildsForMonth.mockRejectedValueOnce(new Error('Archive failure'));
    const client = makeClient();
    await expect(runMonthlyReset(client)).rejects.toThrow('Archive failure');
  });
});
