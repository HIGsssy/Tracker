// Unit tests for /funding status command handler.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { EmbedBuilder } from 'discord.js';

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

// Mock only the DB-backed service functions; let calculationService and embedBuilder run for real.
vi.mock('../../services/fundingService', () => ({
  getGuildConfig: vi.fn(),
  getMonthTotal: vi.fn().mockReturnValue(0),
  getMonthRecords: vi.fn().mockReturnValue([]),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

vi.mock('../../services/trackerService', () => ({
  refreshIfStale: vi.fn().mockResolvedValue(undefined),
  TrackerError: class TrackerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TrackerError';
    }
  },
}));

import { handleStatus } from '../status';
import { getGuildConfig, getMonthTotal, getMonthRecords } from '../../services/fundingService';
import { refreshIfStale } from '../../services/trackerService';

const mockGetGuildConfig = vi.mocked(getGuildConfig);
const mockGetMonthTotal = vi.mocked(getMonthTotal);
const mockGetMonthRecords = vi.mocked(getMonthRecords);
const mockRefreshIfStale = vi.mocked(refreshIfStale);

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
  updatedAt: '2026-04-15T10:00:00.000Z',
};

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
} = {}): ChatInputCommandInteraction {
  const { guildId = 'guild-001', hasManageGuild = false } = overrides;

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    user: { id: 'user-001' },
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

/** Extracts the EmbedBuilder from the first editReply call that passed an embed. */
function getEmbed(interaction: ChatInputCommandInteraction): EmbedBuilder {
  const calls = vi.mocked(interaction.editReply).mock.calls;
  for (const [arg] of calls) {
    if (typeof arg === 'object' && arg !== null && 'embeds' in arg) {
      return (arg as { embeds: EmbedBuilder[] }).embeds[0]!;
    }
  }
  throw new Error('No embed found in editReply calls');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGuildConfig.mockReturnValue(BASE_CONFIG as ReturnType<typeof getGuildConfig>);
  mockGetMonthTotal.mockReturnValue(50.00);
  mockGetMonthRecords.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding status — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleStatus(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
  });
});

// ---------------------------------------------------------------------------
// Unconfigured tracker
// ---------------------------------------------------------------------------

describe('/funding status — unconfigured', () => {
  it('responds with not-configured message when config is null', async () => {
    mockGetGuildConfig.mockReturnValue(null);
    const interaction = makeInteraction();
    await handleStatus(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not configured'),
    );
  });

  it('responds with not-configured message when enabled is false', async () => {
    mockGetGuildConfig.mockReturnValue({ ...BASE_CONFIG, enabled: false } as ReturnType<typeof getGuildConfig>);
    const interaction = makeInteraction();
    await handleStatus(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not configured'),
    );
  });
});

// ---------------------------------------------------------------------------
// Public (non-admin) response
// ---------------------------------------------------------------------------

describe('/funding status — public member response', () => {
  it('responds with an embed', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    const calls = vi.mocked(interaction.editReply).mock.calls;
    const embedCall = calls.find(([arg]) =>
      typeof arg === 'object' && arg !== null && 'embeds' in arg,
    );
    expect(embedCall).toBeDefined();
  });

  it('embed contains "Monthly Coverage" field', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Monthly Coverage');
  });

  it('embed contains "Hours Left" field', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Hours Left');
  });

  it('embed contains "Last Updated" field', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Last Updated');
  });

  it('does not include admin-only fields for non-admin', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).not.toContain('Total Funded');
    expect(fieldNames).not.toContain('Hourly Cost');
    expect(fieldNames).not.toContain('Records This Month');
  });

  it('does not call getMonthRecords for non-admin', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleStatus(interaction);
    expect(mockGetMonthRecords).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin response (ManageGuild)
// ---------------------------------------------------------------------------

describe('/funding status — admin response', () => {
  it('embed contains admin-only "Total Funded" field', async () => {
    const interaction = makeInteraction({ hasManageGuild: true });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Total Funded');
  });

  it('embed contains admin-only "Hourly Cost" field', async () => {
    const interaction = makeInteraction({ hasManageGuild: true });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Hourly Cost');
  });

  it('embed contains admin-only "Records This Month" field', async () => {
    mockGetMonthRecords.mockReturnValue([
      { id: 1, guildId: 'guild-001', monthKey: '2026-04', amount: 25, recordedAt: '', createdByUserId: 'u1', donorName: null, note: null },
      { id: 2, guildId: 'guild-001', monthKey: '2026-04', amount: 25, recordedAt: '', createdByUserId: 'u2', donorName: null, note: null },
    ] as ReturnType<typeof getMonthRecords>);
    const interaction = makeInteraction({ hasManageGuild: true });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const recordsField = embed.data.fields?.find((f) => f.name === 'Records This Month');
    expect(recordsField?.value).toBe('2');
  });

  it('admin embed still contains all public fields', async () => {
    const interaction = makeInteraction({ hasManageGuild: true });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Monthly Coverage');
    expect(fieldNames).toContain('Hours Left');
    expect(fieldNames).toContain('Last Updated');
  });

  it('Total Funded value includes the dollar amount', async () => {
    mockGetMonthTotal.mockReturnValue(43.75);
    const interaction = makeInteraction({ hasManageGuild: true });
    await handleStatus(interaction);
    const embed = getEmbed(interaction);
    const fundedField = embed.data.fields?.find((f) => f.name === 'Total Funded');
    expect(fundedField?.value).toBe('$43.75');
  });
});

// ---------------------------------------------------------------------------
// Stale refresh after reply
// ---------------------------------------------------------------------------

describe('/funding status — stale refresh wiring', () => {
  it('calls refreshIfStale after sending the reply', async () => {
    const interaction = makeInteraction();
    await handleStatus(interaction);
    expect(mockRefreshIfStale).toHaveBeenCalledOnce();
    expect(mockRefreshIfStale).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('editReply is called before refreshIfStale', async () => {
    const callOrder: string[] = [];
    const interaction = makeInteraction();
    vi.mocked(interaction.editReply).mockImplementation(async () => {
      callOrder.push('editReply');
      return {} as never;
    });
    mockRefreshIfStale.mockImplementation(async () => {
      callOrder.push('refreshIfStale');
    });
    await handleStatus(interaction);
    expect(callOrder.indexOf('editReply')).toBeLessThan(callOrder.indexOf('refreshIfStale'));
  });

  it('does not surface refreshIfStale errors to the user', async () => {
    mockRefreshIfStale.mockRejectedValueOnce(new Error('stale refresh failed'));
    const interaction = makeInteraction();
    // Should complete without throwing despite stale refresh error.
    await expect(handleStatus(interaction)).resolves.not.toThrow();
    // The error should not appear in the reply content.
    const editReplyCalls = vi.mocked(interaction.editReply).mock.calls;
    const textReplies = editReplyCalls
      .map(([arg]) => (typeof arg === 'string' ? arg : ''))
      .filter(Boolean);
    for (const text of textReplies) {
      expect(text).not.toContain('stale refresh failed');
    }
  });

  it('does not call refreshIfStale when guild is not set', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleStatus(interaction);
    expect(mockRefreshIfStale).not.toHaveBeenCalled();
  });
});
