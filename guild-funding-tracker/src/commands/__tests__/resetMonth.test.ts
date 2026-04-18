// Unit tests for /funding reset-month command handler.

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

vi.mock('../../services/calculationService', () => ({
  getPreviousMonthKey: vi.fn().mockReturnValue('2026-03'),
}));

vi.mock('../../services/archiveService', () => ({
  archiveMonth: vi.fn(),
  ArchiveError: class ArchiveError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ArchiveError';
    }
  },
}));

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

import { handleResetMonth } from '../resetMonth';
import { archiveMonth, ArchiveError } from '../../services/archiveService';
import { getGuildConfig } from '../../services/fundingService';
import { refreshTracker, TrackerError } from '../../services/trackerService';
import { getPreviousMonthKey } from '../../services/calculationService';

const mockArchiveMonth = vi.mocked(archiveMonth);
const mockGetGuildConfig = vi.mocked(getGuildConfig);
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

function makeBtnInteraction(customId: 'confirm_reset_month' | 'cancel_reset_month') {
  return {
    customId,
    user: { id: 'user-001' },
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
  month?: string | null;
  buttonId?: 'confirm_reset_month' | 'cancel_reset_month' | 'timeout';
} = {}): ChatInputCommandInteraction {
  const {
    guildId = 'guild-001',
    hasManageGuild = true,
    month = null,
    buttonId = 'confirm_reset_month',
  } = overrides;

  const btnInteraction = buttonId !== 'timeout' ? makeBtnInteraction(buttonId) : null;

  const msg = {
    awaitMessageComponent:
      buttonId === 'timeout'
        ? vi.fn().mockRejectedValue(new Error('Collector timeout'))
        : vi.fn().mockResolvedValue(btnInteraction),
  };

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    user: { id: 'user-001' },
    memberPermissions: {
      has: vi.fn().mockReturnValue(hasManageGuild),
    },
    options: {
      getString: vi.fn().mockReturnValue(month),
    },
    client: {},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    fetchReply: vi.fn().mockResolvedValue(msg),
    replied: false,
    deferred: true,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGuildConfig.mockReturnValue(BASE_CONFIG);
  mockGetPreviousMonthKey.mockReturnValue('2026-03');
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding reset-month — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

describe('/funding reset-month — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Month option validation
// ---------------------------------------------------------------------------

describe('/funding reset-month — month option', () => {
  it('uses previous month key when no month option provided', async () => {
    const interaction = makeInteraction({ month: null });
    await handleResetMonth(interaction);
    expect(mockGetPreviousMonthKey).toHaveBeenCalled();
    const btnInteraction = (await interaction.fetchReply()).awaitMessageComponent as ReturnType<typeof vi.fn>;
    const updateCall = (await btnInteraction.mock.results[0].value).update as ReturnType<typeof vi.fn>;
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('2026-03') }),
    );
  });

  it('uses the provided month option when valid', async () => {
    const interaction = makeInteraction({ month: '2026-01' });
    await handleResetMonth(interaction);
    // Should not call getPreviousMonthKey when month is provided
    expect(mockGetPreviousMonthKey).not.toHaveBeenCalled();
    expect(mockArchiveMonth).toHaveBeenCalledWith('guild-001', '2026-01');
  });

  it('rejects an invalid month format (bad string)', async () => {
    const interaction = makeInteraction({ month: 'not-a-month' });
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid month format'),
    );
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });

  it('rejects an invalid month number (13)', async () => {
    const interaction = makeInteraction({ month: '2026-13' });
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid month format'),
    );
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });

  it('accepts a valid month at boundary (12)', async () => {
    const interaction = makeInteraction({ month: '2025-12' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).toHaveBeenCalledWith('guild-001', '2025-12');
  });
});

// ---------------------------------------------------------------------------
// Confirmation flow
// ---------------------------------------------------------------------------

describe('/funding reset-month — confirmation', () => {
  it('shows a confirmation prompt with buttons', async () => {
    const interaction = makeInteraction();
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: expect.arrayContaining([expect.anything()]) }),
    );
  });

  it('does not archive when user cancels', async () => {
    const interaction = makeInteraction({ buttonId: 'cancel_reset_month' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).not.toHaveBeenCalled();
  });

  it('responds with cancelled message when user cancels', async () => {
    const interaction = makeInteraction({ buttonId: 'cancel_reset_month' });
    await handleResetMonth(interaction);
    const msg = await interaction.fetchReply();
    const btnResult = await msg.awaitMessageComponent();
    expect((btnResult as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('cancelled') }),
    );
  });

  it('does not archive when confirmation times out', async () => {
    const interaction = makeInteraction({ buttonId: 'timeout' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('timed out') }),
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmed archive path
// ---------------------------------------------------------------------------

describe('/funding reset-month — confirmed archive', () => {
  it('calls archiveMonth with correct guild and month', async () => {
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).toHaveBeenCalledWith('guild-001', '2026-03');
  });

  it('calls refreshTracker after archiving when tracker is configured', async () => {
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('responds with success message containing the month', async () => {
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    const msg = await interaction.fetchReply();
    const btnResult = await msg.awaitMessageComponent();
    expect((btnResult as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('2026-03') }),
    );
  });

  it('does not call refreshTracker when tracker channel is not configured', async () => {
    mockGetGuildConfig.mockReturnValue({ ...BASE_CONFIG, trackerChannelId: null });
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).toHaveBeenCalled();
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('still succeeds when getGuildConfig returns null (no tracker set up)', async () => {
    mockGetGuildConfig.mockReturnValue(null);
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).toHaveBeenCalled();
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('succeeds with a note when refreshTracker throws TrackerError', async () => {
    mockRefreshTracker.mockRejectedValueOnce(
      new TrackerError('No tracker channel configured.'),
    );
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(mockArchiveMonth).toHaveBeenCalled();
    const msg = await interaction.fetchReply();
    const btnResult = await msg.awaitMessageComponent();
    expect((btnResult as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('archived successfully'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('/funding reset-month — error handling', () => {
  it('surfaces ArchiveError message to user via button update', async () => {
    mockArchiveMonth.mockImplementationOnce(() => {
      throw new ArchiveError('No config found for guild guild-001.');
    });
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    // ArchiveError after button confirmation: handler must update the button interaction,
    // not editReply, so Discord does not show "This interaction failed" on the button.
    const msg = await interaction.fetchReply();
    const btnResult = await msg.awaitMessageComponent();
    expect((btnResult as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No config found'),
        components: [],
      }),
    );
  });

  it('responds with generic error for unknown failures', async () => {
    mockArchiveMonth.mockImplementationOnce(() => {
      throw new Error('Unexpected DB error');
    });
    const interaction = makeInteraction({ month: '2026-03' });
    await handleResetMonth(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });
});
