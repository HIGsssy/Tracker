// Unit tests for the hourly embed refresh scheduler.
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

import { msUntilNextHour, runHourlyEmbedRefresh } from '../embedRefresh';
import { getAllEnabledConfigs } from '../../services/fundingService';
import { refreshTracker } from '../../services/trackerService';
import type { Client } from 'discord.js';

const mockGetAllEnabledConfigs = vi.mocked(getAllEnabledConfigs);
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

function makeClient(): Client {
  return {} as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllEnabledConfigs.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// msUntilNextHour
// ---------------------------------------------------------------------------

describe('msUntilNextHour', () => {
  it('returns 3600000ms at the exact top of an hour', () => {
    expect(msUntilNextHour(new Date('2026-04-15T14:00:00.000Z'))).toBe(3_600_000);
  });

  it('returns 1800000ms at 30 minutes past the hour', () => {
    expect(msUntilNextHour(new Date('2026-04-15T14:30:00.000Z'))).toBe(1_800_000);
  });

  it('returns 60000ms at 59 minutes past the hour', () => {
    expect(msUntilNextHour(new Date('2026-04-15T14:59:00.000Z'))).toBe(60_000);
  });

  it('returns ~3600000ms at one millisecond past the top of an hour', () => {
    expect(msUntilNextHour(new Date('2026-04-15T14:00:00.001Z'))).toBe(3_599_999);
  });

  it('never returns a negative value', () => {
    expect(msUntilNextHour(new Date())).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runHourlyEmbedRefresh
// ---------------------------------------------------------------------------

describe('runHourlyEmbedRefresh', () => {
  it('does nothing when no guilds are configured', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([]);
    await runHourlyEmbedRefresh(makeClient());
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('refreshes all guilds that have a trackerChannelId', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([
      { ...BASE_CONFIG, guildId: 'guild-001' },
      { ...BASE_CONFIG, guildId: 'guild-002' },
    ]);
    await runHourlyEmbedRefresh(makeClient());
    expect(mockRefreshTracker).toHaveBeenCalledTimes(2);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', expect.anything());
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-002', expect.anything());
  });

  it('skips guilds without a trackerChannelId', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([
      { ...BASE_CONFIG, guildId: 'guild-001', trackerChannelId: null },
    ]);
    await runHourlyEmbedRefresh(makeClient());
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('continues refreshing remaining guilds if one throws', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([
      { ...BASE_CONFIG, guildId: 'guild-001' },
      { ...BASE_CONFIG, guildId: 'guild-002' },
    ]);
    mockRefreshTracker
      .mockRejectedValueOnce(new Error('channel not found'))
      .mockResolvedValueOnce({ action: 'edited' });

    await expect(runHourlyEmbedRefresh(makeClient())).resolves.not.toThrow();
    expect(mockRefreshTracker).toHaveBeenCalledTimes(2);
  });

  it('does not propagate errors from individual guild refreshes', async () => {
    mockGetAllEnabledConfigs.mockReturnValue([{ ...BASE_CONFIG, guildId: 'guild-001' }]);
    mockRefreshTracker.mockRejectedValue(new Error('boom'));
    await expect(runHourlyEmbedRefresh(makeClient())).resolves.not.toThrow();
  });
});
