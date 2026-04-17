import { describe, it, expect } from 'vitest';
import { buildFundingEmbed, formatHoursLeft, formatCoverage } from '../embedBuilder';
import { buildProgressBar } from '../progressBar';
import type { FundingState, EmbedConfigInput } from '../../types/funding';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const baseConfig: EmbedConfigInput = {
  displayTitle: 'Server Funding',
  updatedAt: '2026-04-15T10:00:00.000Z',
  publicDisplayMode: 'standard',
};

function makeState(overrides: Partial<FundingState> = {}): FundingState {
  return {
    monthKey: '2026-04',
    monthHours: 720,
    fundedHours: 250,
    hoursElapsed: 168,
    hoursLeft: 82,
    percentageFunded: 34.72,
    isFullyFunded: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatHoursLeft
// ---------------------------------------------------------------------------
describe('formatHoursLeft', () => {
  it('formats hours and minutes correctly', () => {
    expect(formatHoursLeft(387.5)).toBe('387h 30m');
  });

  it('returns "0h 0m" for zero', () => {
    expect(formatHoursLeft(0)).toBe('0h 0m');
  });

  it('returns "0h 0m" for negative values', () => {
    expect(formatHoursLeft(-5)).toBe('0h 0m');
  });

  it('handles whole hours with no minutes', () => {
    expect(formatHoursLeft(100)).toBe('100h 0m');
  });

  it('handles values less than 1 hour', () => {
    expect(formatHoursLeft(0.5)).toBe('0h 30m');
  });
});

// ---------------------------------------------------------------------------
// formatCoverage
// ---------------------------------------------------------------------------
describe('formatCoverage', () => {
  it('formats 100% as "100%"', () => {
    expect(formatCoverage(100)).toBe('100%');
  });

  it('formats fractional percentage with one decimal', () => {
    expect(formatCoverage(34.72)).toBe('34.7%');
  });

  it('formats zero as "0%"', () => {
    expect(formatCoverage(0)).toBe('0%');
  });

  it('rounds to one decimal place', () => {
    expect(formatCoverage(66.666)).toBe('66.7%');
  });

  it('strips trailing .0 for whole numbers', () => {
    expect(formatCoverage(75)).toBe('75%');
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — field labels
// ---------------------------------------------------------------------------
describe('buildFundingEmbed field labels', () => {
  it('contains a field named exactly "Monthly Coverage"', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const field = json.fields?.find((f) => f.name === 'Monthly Coverage');
    expect(field).toBeDefined();
  });

  it('contains a field named exactly "Hours Left"', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const field = json.fields?.find((f) => f.name === 'Hours Left');
    expect(field).toBeDefined();
  });

  it('contains a field named exactly "Last Updated"', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const field = json.fields?.find((f) => f.name === 'Last Updated');
    expect(field).toBeDefined();
  });

  it('does NOT contain any field named "Percentage Funded"', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const bad = json.fields?.find((f) => f.name === 'Percentage Funded');
    expect(bad).toBeUndefined();
  });

  it('does NOT contain any field named "Funded This Month"', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const bad = json.fields?.find((f) => f.name === 'Funded This Month');
    expect(bad).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — title
// ---------------------------------------------------------------------------
describe('buildFundingEmbed title', () => {
  it('includes the display title from config', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    expect(embed.toJSON().title).toContain('Server Funding');
  });

  it('includes the month label', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ monthKey: '2026-04' }));
    expect(embed.toJSON().title).toContain('April 2026');
  });

  it('uses a custom display title', () => {
    const config: EmbedConfigInput = { ...baseConfig, displayTitle: 'My Community' };
    const embed = buildFundingEmbed(config, makeState());
    expect(embed.toJSON().title).toContain('My Community');
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — description / progress bar
// ---------------------------------------------------------------------------
describe('buildFundingEmbed description', () => {
  it('description contains block characters from the progress bar', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 65 }));
    const desc = embed.toJSON().description ?? '';
    // A non-zero, non-full percentage should have both filled and empty chars
    expect(desc).toContain('█');
    expect(desc).toContain('░');
  });

  it('description at 0% is all empty blocks', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 0 }));
    const desc = embed.toJSON().description ?? '';
    expect(desc).toBe(buildProgressBar(0));
    expect(desc).not.toContain('█');
  });

  it('description at 100% is all filled blocks', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 100 }));
    const desc = embed.toJSON().description ?? '';
    expect(desc).toBe(buildProgressBar(100));
    expect(desc).not.toContain('░');
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — embed color tiers
// ---------------------------------------------------------------------------
describe('buildFundingEmbed color', () => {
  it('is green (0x57f287) at 75%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 75 }));
    expect(embed.toJSON().color).toBe(0x57f287);
  });

  it('is green (0x57f287) at 100%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 100 }));
    expect(embed.toJSON().color).toBe(0x57f287);
  });

  it('is yellow (0xfee75c) at 50%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 50 }));
    expect(embed.toJSON().color).toBe(0xfee75c);
  });

  it('is yellow (0xfee75c) at 25%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 25 }));
    expect(embed.toJSON().color).toBe(0xfee75c);
  });

  it('is yellow (0xfee75c) at 74%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 74 }));
    expect(embed.toJSON().color).toBe(0xfee75c);
  });

  it('is red (0xed4245) at 24%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 24 }));
    expect(embed.toJSON().color).toBe(0xed4245);
  });

  it('is red (0xed4245) at 0%', () => {
    const embed = buildFundingEmbed(baseConfig, makeState({ percentageFunded: 0 }));
    expect(embed.toJSON().color).toBe(0xed4245);
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — Last Updated timestamp format
// ---------------------------------------------------------------------------
describe('buildFundingEmbed Last Updated field', () => {
  it('value matches Discord relative timestamp format <t:UNIX:R>', () => {
    const embed = buildFundingEmbed(baseConfig, makeState());
    const json = embed.toJSON();
    const lastUpdated = json.fields?.find((f) => f.name === 'Last Updated');
    expect(lastUpdated?.value).toMatch(/^<t:\d+:R>$/);
  });

  it('Unix timestamp is derived from config.updatedAt', () => {
    const updatedAt = '2026-04-15T10:00:00.000Z';
    const expectedUnix = Math.floor(new Date(updatedAt).getTime() / 1000);
    const embed = buildFundingEmbed({ ...baseConfig, updatedAt }, makeState());
    const json = embed.toJSON();
    const lastUpdated = json.fields?.find((f) => f.name === 'Last Updated');
    expect(lastUpdated?.value).toBe(`<t:${expectedUnix}:R>`);
  });
});

// ---------------------------------------------------------------------------
// buildFundingEmbed — Hours Left field with zero hours
// ---------------------------------------------------------------------------
describe('buildFundingEmbed with zero hours left', () => {
  it('Hours Left field shows "0h 0m" when coverage is exhausted', () => {
    const state = makeState({ hoursLeft: 0, percentageFunded: 34.72 });
    const embed = buildFundingEmbed(baseConfig, state);
    const json = embed.toJSON();
    const hoursLeftField = json.fields?.find((f) => f.name === 'Hours Left');
    expect(hoursLeftField?.value).toBe('0h 0m');
  });

  it('Monthly Coverage is still non-zero when hours left is 0', () => {
    // Proves the divergence case: coverage > 0% AND hours_left = 0
    const state = makeState({ hoursLeft: 0, percentageFunded: 34.72 });
    const embed = buildFundingEmbed(baseConfig, state);
    const json = embed.toJSON();
    const coverageField = json.fields?.find((f) => f.name === 'Monthly Coverage');
    expect(coverageField?.value).not.toBe('0%');
    expect(coverageField?.value).toBe('34.7%');
  });
});
