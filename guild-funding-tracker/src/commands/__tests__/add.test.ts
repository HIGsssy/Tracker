// Unit tests for /funding add command handler.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
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
  addDonation: vi.fn(),
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

import { handleAdd } from '../add';
import { addDonation, ValidationError } from '../../services/fundingService';
import { refreshTracker } from '../../services/trackerService';

const mockAddDonation = vi.mocked(addDonation);
const mockRefreshTracker = vi.mocked(refreshTracker);

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
  amount?: number | null;
  donorName?: string | null;
  note?: string | null;
} = {}): ChatInputCommandInteraction {
  const {
    guildId = 'guild-001',
    hasManageGuild = true,
    amount = 25.00,
    donorName = null,
    note = null,
  } = overrides;

  const memberPerms = {
    has: vi.fn().mockImplementation((flag) =>
      hasManageGuild ? true : flag !== PermissionFlagsBits.ManageGuild,
    ),
  };

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    user: { id: 'user-001' },
    memberPermissions: hasManageGuild ? memberPerms : { has: vi.fn().mockReturnValue(false) },
    options: {
      getNumber: vi.fn().mockReturnValue(amount),
      getString: vi.fn((name: string) => (name === 'donor_name' ? donorName : note)),
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
  mockAddDonation.mockReturnValue({
    id: 1,
    guildId: 'guild-001',
    monthKey: '2026-04',
    amount: 25.00,
    recordedAt: new Date().toISOString(),
    donorName: null,
    note: null,
    createdByUserId: 'user-001',
  } as ReturnType<typeof addDonation>);
});

describe('/funding add — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleAdd(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockAddDonation).not.toHaveBeenCalled();
  });
});

describe('/funding add — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleAdd(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockAddDonation).not.toHaveBeenCalled();
  });
});

describe('/funding add — validation', () => {
  it('surfaces ValidationError message for invalid amount', async () => {
    const { ValidationError: VE } = await import('../../services/fundingService');
    mockAddDonation.mockImplementation(() => { throw new VE('Amount must be a positive finite number.'); });

    const interaction = makeInteraction({ amount: -5 });
    await handleAdd(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Amount must be a positive finite number'),
    );
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });
});

describe('/funding add — success path', () => {
  it('calls addDonation with correct arguments', async () => {
    const interaction = makeInteraction({ amount: 12.50, donorName: 'Alice', note: 'sub' });
    await handleAdd(interaction);
    expect(mockAddDonation).toHaveBeenCalledWith(
      'guild-001', 12.50, 'user-001', 'Alice', 'sub',
    );
  });

  it('calls refreshTracker after addDonation', async () => {
    const interaction = makeInteraction();
    await handleAdd(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('responds with a success message including amount and month', async () => {
    const interaction = makeInteraction({ amount: 25.00 });
    await handleAdd(interaction);
    const reply = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as string;
    expect(reply).toContain('25.00');
    expect(reply).toContain('2026-04');
    expect(reply).toContain('Tracker updated');
  });

  it('passes undefined for omitted donor_name and note', async () => {
    const interaction = makeInteraction({ donorName: null, note: null });
    await handleAdd(interaction);
    expect(mockAddDonation).toHaveBeenCalledWith(
      'guild-001', 25.00, 'user-001', undefined, undefined,
    );
  });
});

describe('/funding add — error handling', () => {
  it('responds with generic fallback for unexpected errors', async () => {
    mockAddDonation.mockImplementation(() => { throw new Error('DB exploded'); });
    const interaction = makeInteraction();
    await handleAdd(interaction);
    const reply = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as string;
    expect(reply).toContain('Something went wrong');
  });

  it('does not call refreshTracker when addDonation throws', async () => {
    mockAddDonation.mockImplementation(() => { throw new Error('fail'); });
    const interaction = makeInteraction();
    await handleAdd(interaction);
    expect(mockRefreshTracker).not.toHaveBeenCalled();
  });
});
