// Integration tests for fundingService using an in-memory SQLite DB.
// The db/client module is mocked with a fresh in-memory instance that has
// the real schema applied via the migration SQL file.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config/env so it doesn't call process.exit during import resolution.
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

// Mock db/client with an in-memory DB seeded from the real migration SQL.
vi.mock('../../db/client', async () => {
  const { createTestDb } = await import('../../db/testDb');
  return { db: createTestDb() };
});

// Import services AFTER mocks are registered.
import { db } from '../../db/client';
import { guildTrackerConfig, donationRecord } from '../../db/schema';
import {
  getGuildConfig,
  upsertGuildConfig,
  getMonthTotal,
  ValidationError,
} from '../fundingService';

const GUILD_A = 'guild-111';
const GUILD_B = 'guild-222';

beforeEach(() => {
  // Clear all tables between tests to prevent state bleed.
  db.delete(donationRecord).run();
  db.delete(guildTrackerConfig).run();
});

describe('getGuildConfig', () => {
  it('returns null when no config exists', () => {
    expect(getGuildConfig(GUILD_A)).toBeNull();
  });

  it('returns config after creation', () => {
    upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-1' });
    const cfg = getGuildConfig(GUILD_A);
    expect(cfg).not.toBeNull();
    expect(cfg!.guildId).toBe(GUILD_A);
    expect(cfg!.trackerChannelId).toBe('ch-1');
  });
});

describe('upsertGuildConfig', () => {
  it('creates a new config row with defaults', () => {
    const cfg = upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-1' });
    expect(cfg.guildId).toBe(GUILD_A);
    expect(cfg.enabled).toBe(true);
    expect(cfg.hourlyCost).toBe(0.06);
    expect(cfg.displayTitle).toBe('Server Funding');
    expect(cfg.publicDisplayMode).toBe('standard');
    expect(cfg.trackerChannelId).toBe('ch-1');
    expect(cfg.trackerMessageId).toBeNull();
  });

  it('does not create duplicate rows when called twice for the same guild', () => {
    upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-1' });
    upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-2' });
    const rows = db.select().from(guildTrackerConfig).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trackerChannelId).toBe('ch-2');
  });

  it('updates individual fields without overwriting others', () => {
    upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-1', displayTitle: 'My Server' });
    upsertGuildConfig(GUILD_A, { trackerMessageId: 'msg-99' });
    const cfg = getGuildConfig(GUILD_A)!;
    expect(cfg.trackerChannelId).toBe('ch-1');   // unchanged
    expect(cfg.displayTitle).toBe('My Server');   // unchanged
    expect(cfg.trackerMessageId).toBe('msg-99');  // updated
  });

  it('preserves created_at on updates', () => {
    const first = upsertGuildConfig(GUILD_A, {});
    const second = upsertGuildConfig(GUILD_A, { displayTitle: 'Changed' });
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('isolates different guilds', () => {
    upsertGuildConfig(GUILD_A, { trackerChannelId: 'ch-A' });
    upsertGuildConfig(GUILD_B, { trackerChannelId: 'ch-B' });
    expect(getGuildConfig(GUILD_A)!.trackerChannelId).toBe('ch-A');
    expect(getGuildConfig(GUILD_B)!.trackerChannelId).toBe('ch-B');
  });

  it('accepts valid hourlyCost at the minimum bound', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 0.001 })).not.toThrow();
    expect(getGuildConfig(GUILD_A)!.hourlyCost).toBe(0.001);
  });

  it('accepts valid hourlyCost at the maximum bound', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 1000 })).not.toThrow();
  });

  it('throws ValidationError for hourlyCost below minimum', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 0.0009 })).toThrow(ValidationError);
  });

  it('throws ValidationError for hourlyCost above maximum', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 1000.01 })).toThrow(ValidationError);
  });

  it('throws ValidationError for hourlyCost = 0', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 0 })).toThrow(ValidationError);
  });

  it('throws ValidationError for hourlyCost = NaN', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: NaN })).toThrow(ValidationError);
  });

  it('throws ValidationError for hourlyCost = Infinity', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: Infinity })).toThrow(ValidationError);
  });

  it('does not mutate DB when validation fails', () => {
    expect(() => upsertGuildConfig(GUILD_A, { hourlyCost: 0 })).toThrow();
    expect(getGuildConfig(GUILD_A)).toBeNull();
  });
});

describe('getMonthTotal', () => {
  it('returns 0 when no donation records exist for the guild and month', () => {
    expect(getMonthTotal(GUILD_A, '2026-04')).toBe(0);
  });

  it('returns 0 for a different month with no records', () => {
    // Insert a record for April but query May.
    db.insert(donationRecord).values({
      guildId: GUILD_A,
      monthKey: '2026-04',
      amount: 10,
      recordedAt: new Date().toISOString(),
      createdByUserId: 'user-1',
    }).run();
    expect(getMonthTotal(GUILD_A, '2026-05')).toBe(0);
  });

  it('sums amounts for the correct guild and month', () => {
    db.insert(donationRecord).values([
      { guildId: GUILD_A, monthKey: '2026-04', amount: 10, recordedAt: new Date().toISOString(), createdByUserId: 'u1' },
      { guildId: GUILD_A, monthKey: '2026-04', amount: 5.5, recordedAt: new Date().toISOString(), createdByUserId: 'u2' },
      { guildId: GUILD_A, monthKey: '2026-03', amount: 20, recordedAt: new Date().toISOString(), createdByUserId: 'u3' },
      { guildId: GUILD_B, monthKey: '2026-04', amount: 100, recordedAt: new Date().toISOString(), createdByUserId: 'u4' },
    ]).run();

    expect(getMonthTotal(GUILD_A, '2026-04')).toBeCloseTo(15.5);
    expect(getMonthTotal(GUILD_A, '2026-03')).toBe(20);
    expect(getMonthTotal(GUILD_B, '2026-04')).toBe(100);
  });
});
