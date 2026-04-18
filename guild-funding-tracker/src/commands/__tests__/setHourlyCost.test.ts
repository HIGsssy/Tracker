// Unit tests for /funding set-hourly-cost command handler.

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
  upsertGuildConfig: vi.fn(),
  getGuildConfig: vi.fn().mockReturnValue(null),
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

import { handleSetHourlyCost } from '../setHourlyCost';
import { upsertGuildConfig, ValidationError } from '../../services/fundingService';
import { refreshTracker, TrackerError } from '../../services/trackerService';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../../constants/validation';

const mockUpsertGuildConfig = vi.mocked(upsertGuildConfig);
const mockRefreshTracker = vi.mocked(refreshTracker);

function makeInteraction(overrides: {
  guildId?: string | null;
  hasManageGuild?: boolean;
  cost?: number | null;
} = {}): ChatInputCommandInteraction {
  const { guildId = 'guild-001', hasManageGuild = true, cost = 0.08 } = overrides;

  return {
    guildId,
    guild: guildId ? { id: guildId } : null,
    memberPermissions: {
      has: vi.fn().mockReturnValue(hasManageGuild),
    },
    options: {
      getNumber: vi.fn().mockReturnValue(cost),
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
});

// ---------------------------------------------------------------------------
// Guild guard
// ---------------------------------------------------------------------------

describe('/funding set-hourly-cost — guild guard', () => {
  it('rejects when used outside a guild', async () => {
    const interaction = makeInteraction({ guildId: null });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('only be used in a server'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

describe('/funding set-hourly-cost — permission guard', () => {
  it('rejects when member lacks ManageGuild', async () => {
    const interaction = makeInteraction({ hasManageGuild: false });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('do not have permission'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validation — cost bounds
// ---------------------------------------------------------------------------

describe('/funding set-hourly-cost — validation', () => {
  it('rejects cost below MIN_HOURLY_COST', async () => {
    const interaction = makeInteraction({ cost: MIN_HOURLY_COST - 0.0001 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Hourly cost must be between'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects cost above MAX_HOURLY_COST', async () => {
    const interaction = makeInteraction({ cost: MAX_HOURLY_COST + 1 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Hourly cost must be between'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('rejects non-finite cost (NaN)', async () => {
    const interaction = makeInteraction({ cost: NaN });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Hourly cost must be between'),
    );
    expect(mockUpsertGuildConfig).not.toHaveBeenCalled();
  });

  it('accepts cost at MIN_HOURLY_COST boundary', async () => {
    const interaction = makeInteraction({ cost: MIN_HOURLY_COST });
    await handleSetHourlyCost(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalled();
  });

  it('accepts cost at MAX_HOURLY_COST boundary', async () => {
    const interaction = makeInteraction({ cost: MAX_HOURLY_COST });
    await handleSetHourlyCost(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Successful update
// ---------------------------------------------------------------------------

describe('/funding set-hourly-cost — successful update', () => {
  it('calls upsertGuildConfig with the new hourly cost', async () => {
    const interaction = makeInteraction({ cost: 0.12 });
    await handleSetHourlyCost(interaction);
    expect(mockUpsertGuildConfig).toHaveBeenCalledWith('guild-001', { hourlyCost: 0.12 });
  });

  it('calls refreshTracker after updating config', async () => {
    const interaction = makeInteraction({ cost: 0.08 });
    await handleSetHourlyCost(interaction);
    expect(mockRefreshTracker).toHaveBeenCalledWith('guild-001', interaction.client);
  });

  it('responds with a success message containing the new cost', async () => {
    const interaction = makeInteraction({ cost: 0.08 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('$0.08/hr'),
    );
  });
});

// ---------------------------------------------------------------------------
// Error surfaces
// ---------------------------------------------------------------------------

describe('/funding set-hourly-cost — error handling', () => {
  it('surfaces ValidationError message to user', async () => {
    const MockValidationError = ValidationError;
    mockUpsertGuildConfig.mockImplementationOnce(() => {
      throw new MockValidationError('Service-level validation failed');
    });
    const interaction = makeInteraction({ cost: 0.08 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith('Service-level validation failed');
  });

  it('surfaces TrackerError message to user', async () => {
    const MockTrackerError = TrackerError;
    mockRefreshTracker.mockRejectedValueOnce(
      new MockTrackerError('No tracker channel configured.'),
    );
    const interaction = makeInteraction({ cost: 0.08 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No tracker channel configured.'),
    );
  });

  it('responds with generic error message for unknown errors', async () => {
    mockRefreshTracker.mockRejectedValueOnce(new Error('Internal failure'));
    const interaction = makeInteraction({ cost: 0.08 });
    await handleSetHourlyCost(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong'),
    );
  });
});
