// Unit tests for /funding history command handler.

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

vi.mock('../../services/archiveService', () => ({
  getMonthArchive: vi.fn().mockReturnValue(null),
  getRecentArchives: vi.fn().mockReturnValue([]),
}));

import { handleHistory } from '../history';
import { getMonthArchive, getRecentArchives } from '../../services/archiveService';

const mockGetMonthArchive = vi.mocked(getMonthArchive);
const mockGetRecentArchives = vi.mocked(getRecentArchives);

const SAMPLE_ARCHIVE = {
  id: 1,
  guildId: 'guild-001',
  monthKey: '2026-03',
  totalFunded: 15.00,
  hourlyCostSnapshot: 0.06,
  fundedHours: 250,
  monthHours: 744,
  percentageFunded: 33.6,
  finalizedAt: '2026-04-01T00:01:00.000Z',
};

function makeInteraction(overrides: {
  guildId?: string | null;
  month?: string | null;
} = {}): ChatInputCommandInteraction {
  const { guildId = 'guild-001', month = null } = overrides;

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    options: {
      getString: vi.fn().mockReturnValue(month),
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
  mockGetMonthArchive.mockReturnValue(null);
  mockGetRecentArchives.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding history — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockGetMonthArchive).not.toHaveBeenCalled();
    expect(mockGetRecentArchives).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Single month lookup
// ---------------------------------------------------------------------------

describe('/funding history — single month lookup', () => {
  it('calls getMonthArchive with the specified month', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);
    expect(mockGetMonthArchive).toHaveBeenCalledWith('guild-001', '2026-03');
  });

  it('replies with an embed when the archive is found', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.arrayContaining([expect.anything()]) }),
    );
  });

  it('responds with not-found message when no archive exists for the month', async () => {
    mockGetMonthArchive.mockReturnValue(null);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No archive found'),
    );
  });

  it('includes the month key in the not-found message', async () => {
    mockGetMonthArchive.mockReturnValue(null);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('2026-03'),
    );
  });
});

// ---------------------------------------------------------------------------
// Recent history lookup
// ---------------------------------------------------------------------------

describe('/funding history — recent history', () => {
  it('calls getRecentArchives when no month is specified', async () => {
    mockGetRecentArchives.mockReturnValue([SAMPLE_ARCHIVE]);
    const interaction = makeInteraction({ month: null });
    await handleHistory(interaction);
    expect(mockGetRecentArchives).toHaveBeenCalledWith('guild-001', 3);
  });

  it('replies with embeds when archives are found', async () => {
    mockGetRecentArchives.mockReturnValue([SAMPLE_ARCHIVE]);
    const interaction = makeInteraction({ month: null });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.arrayContaining([expect.anything()]) }),
    );
  });

  it('returns one embed per archive row', async () => {
    const archives = [
      { ...SAMPLE_ARCHIVE, id: 1, monthKey: '2026-03' },
      { ...SAMPLE_ARCHIVE, id: 2, monthKey: '2026-02' },
    ];
    mockGetRecentArchives.mockReturnValue(archives);
    const interaction = makeInteraction({ month: null });
    await handleHistory(interaction);
    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as { embeds: unknown[] };
    expect(call.embeds).toHaveLength(2);
  });

  it('responds with no-archive message when history is empty', async () => {
    mockGetRecentArchives.mockReturnValue([]);
    const interaction = makeInteraction({ month: null });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No archived months found'),
    );
  });
});

// ---------------------------------------------------------------------------
// Embed content
// ---------------------------------------------------------------------------

describe('/funding history — embed content', () => {
  it('embed title contains the month key', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ data: { title?: string; fields?: Array<{ name: string; value: string }> } }>;
    };
    expect(call.embeds[0]!.data.title).toContain('2026-03');
  });

  it('embed contains a Monthly Coverage field', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ data: { fields?: Array<{ name: string }> } }>;
    };
    const fieldNames = call.embeds[0]!.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Monthly Coverage');
  });

  it('embed contains a Funded Hours field', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ data: { fields?: Array<{ name: string }> } }>;
    };
    const fieldNames = call.embeds[0]!.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Funded Hours');
  });

  it('embed contains a Total Funded field', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ data: { fields?: Array<{ name: string }> } }>;
    };
    const fieldNames = call.embeds[0]!.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Total Funded');
  });

  it('embed contains a Finalized field', async () => {
    mockGetMonthArchive.mockReturnValue(SAMPLE_ARCHIVE);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleHistory(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
      embeds: Array<{ data: { fields?: Array<{ name: string }> } }>;
    };
    const fieldNames = call.embeds[0]!.data.fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('Finalized');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('/funding history — error handling', () => {
  it('responds with generic error for unknown failures', async () => {
    mockGetRecentArchives.mockImplementationOnce(() => {
      throw new Error('Unexpected failure');
    });
    const interaction = makeInteraction({ month: null });
    await handleHistory(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });
});
