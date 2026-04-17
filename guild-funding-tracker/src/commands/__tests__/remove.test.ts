// Unit tests for /funding remove command handler.

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
  getDonationRecord: vi.fn(),
  removeDonation: vi.fn(),
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

vi.mock('../../services/trackerService', () => ({
  refreshTracker: vi.fn().mockResolvedValue(undefined),
  TrackerError: class TrackerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TrackerError';
    }
  },
}));

import { handleRemove } from '../remove';
import { getDonationRecord, removeDonation } from '../../services/fundingService';
import { refreshTracker } from '../../services/trackerService';

const mockGetDonationRecord = vi.mocked(getDonationRecord);
const mockRemoveDonation = vi.mocked(removeDonation);
const mockRefreshTracker = vi.mocked(refreshTracker);

const SAMPLE_RECORD = {
  id: 42,
  guildId: 'guild-001',
  monthKey: '2026-04',
  amount: 15.00,
  recordedAt: new Date().toISOString(),
  donorName: null,
  note: null,
  createdByUserId: 'user-001',
};

function makeBtnInteraction(customId: 'confirm_remove' | 'cancel_remove') {
  return {
    customId,
    user: { id: 'user-001' },
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
  recordId?: number;
  confirmButtonId?: 'confirm_remove' | 'cancel_remove' | 'timeout';
} = {}): ChatInputCommandInteraction {
  const {
    guildId = 'guild-001',
    hasManageGuild = true,
    recordId = 42,
    confirmButtonId = 'confirm_remove',
  } = overrides;

  const btnInteraction = confirmButtonId !== 'timeout'
    ? makeBtnInteraction(confirmButtonId)
    : null;

  const msg = {
    awaitMessageComponent: confirmButtonId === 'timeout'
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
      getInteger: vi.fn().mockReturnValue(recordId),
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
  mockGetDonationRecord.mockReturnValue(SAMPLE_RECORD as ReturnType<typeof getDonationRecord>);
  mockRemoveDonation.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding remove — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleRemove(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockRemoveDonation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

describe('/funding remove — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleRemove(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockRemoveDonation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing record
// ---------------------------------------------------------------------------

describe('/funding remove — missing record', () => {
  it('responds with not-found when getDonationRecord returns null', async () => {
    mockGetDonationRecord.mockReturnValue(null);
    const interaction = makeInteraction({ recordId: 999 });
    await handleRemove(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('#999 not found'),
    );
    expect(mockRemoveDonation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirmation flow — confirm
// ---------------------------------------------------------------------------

describe('/funding remove — confirmation: confirm', () => {
  it('shows a confirmation prompt with buttons', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'confirm_remove' });
    await handleRemove(interaction);
    const editReplyArg = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as {
      content: string;
      components: unknown[];
    };
    expect(editReplyArg.content).toContain('#42');
    expect(editReplyArg.components).toHaveLength(1);
  });

  it('calls removeDonation with correct guild and record ID', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'confirm_remove' });
    await handleRemove(interaction);
    expect(mockRemoveDonation).toHaveBeenCalledWith('guild-001', 42);
  });

  it('calls refreshTracker after successful removal', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'confirm_remove' });
    await handleRemove(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('updates the button interaction with a success message', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'confirm_remove' });
    await handleRemove(interaction);
    const reply = await interaction.fetchReply();
    const btnInteraction = await reply.awaitMessageComponent({} as never);
    expect(btnInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('#42 removed') }),
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmation flow — cancel
// ---------------------------------------------------------------------------

describe('/funding remove — confirmation: cancel', () => {
  it('does not call removeDonation when cancelled', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'cancel_remove' });
    await handleRemove(interaction);
    expect(mockRemoveDonation).not.toHaveBeenCalled();
  });

  it('does not call refreshTracker when cancelled', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'cancel_remove' });
    await handleRemove(interaction);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('updates button interaction with cancellation message', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'cancel_remove' });
    await handleRemove(interaction);
    const reply = await interaction.fetchReply();
    const btnInteraction = await reply.awaitMessageComponent({} as never);
    expect(btnInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('cancelled') }),
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmation flow — timeout
// ---------------------------------------------------------------------------

describe('/funding remove — confirmation: timeout', () => {
  it('does not call removeDonation on timeout', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'timeout' });
    await handleRemove(interaction);
    expect(mockRemoveDonation).not.toHaveBeenCalled();
  });

  it('does not call refreshTracker on timeout', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'timeout' });
    await handleRemove(interaction);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });

  it('edits reply with timeout message', async () => {
    const interaction = makeInteraction({ confirmButtonId: 'timeout' });
    await handleRemove(interaction);
    // The last editReply call should have the timeout message.
    const calls = vi.mocked(interaction.editReply).mock.calls;
    const lastArg = calls[calls.length - 1]?.[0] as { content: string; components: [] };
    expect(lastArg.content).toContain('timed out');
    expect(lastArg.components).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-guild protection
// ---------------------------------------------------------------------------

describe('/funding remove — cross-guild protection', () => {
  it('returns false from removeDonation if service enforces guild scope', async () => {
    // Simulate a scenario where getDonationRecord found it (passed confirmation)
    // but removeDonation returns false (race condition or cross-guild attempt).
    mockRemoveDonation.mockReturnValue(false);
    const interaction = makeInteraction({ confirmButtonId: 'confirm_remove' });
    await handleRemove(interaction);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
    const reply = await interaction.fetchReply();
    const btnInteraction = await reply.awaitMessageComponent({} as never);
    expect(btnInteraction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not found') }),
    );
  });
});
