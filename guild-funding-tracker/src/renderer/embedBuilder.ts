// The ONLY place where percentageFunded is mapped to the public label "Monthly Coverage".
// No DB access. No Discord client. Pure data-in, EmbedBuilder-out.

import { EmbedBuilder } from 'discord.js';
import type { FundingState, EmbedConfigInput } from '../types/funding';
import { buildProgressBar } from './progressBar';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// Color thresholds: green ≥75%, yellow 25–74%, red <25%
function getEmbedColor(percentageFunded: number): number {
  if (percentageFunded >= 75) return 0x57f287; // green
  if (percentageFunded >= 25) return 0xfee75c; // yellow
  return 0xed4245;                              // red
}

/**
 * Returns a short one-line flavor string matching the current funding state.
 * Tone: slightly edgy, late-night community vibe. Confident, not desperate.
 */
function getFlavorLine(percentageFunded: number, hoursLeft: number): string {
  if (hoursLeft <= 4)        return "clock's ticking\u2026 fast.";
  if (percentageFunded < 25) return "running on fumes \u2014 this won't hold long.";
  if (percentageFunded < 75) return "holding steady, but we're not safe yet.";
  return 'looking real comfortable right now.';
}

/** Formats hours left as "387h 42m" or "0h 0m". */
export function formatHoursLeft(hoursLeft: number): string {
  if (hoursLeft <= 0) return '0h 0m';
  const h = Math.floor(hoursLeft);
  const m = Math.floor((hoursLeft - h) * 60);
  return `${h}h ${m}m`;
}

/** Formats a coverage percentage, stripping unnecessary trailing zeros. */
export function formatCoverage(percentageFunded: number): string {
  const rounded = Math.round(percentageFunded * 10) / 10;
  return `${rounded}%`;
}

function formatMonthLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const monthIndex = parseInt(monthStr, 10) - 1;
  return `${MONTH_NAMES[monthIndex]} ${yearStr}`;
}

/**
 * Builds a Discord EmbedBuilder from config + funding state.
 *
 * Field labels are intentional and must not be changed:
 *   "Monthly Coverage" — fraction of month runtime funded (from percentageFunded)
 *   "Hours Left"       — min(funded_hours_left, month_hours_left); capped to calendar month end
 *   "Last Updated"     — Discord relative timestamp from config.updatedAt
 */
export function buildFundingEmbed(config: EmbedConfigInput, state: FundingState): EmbedBuilder {
  const monthLabel = formatMonthLabel(state.monthKey);
  const progressBar = buildProgressBar(state.percentageFunded);
  const flavorLine = getFlavorLine(state.percentageFunded, state.displayHoursLeft);
  const updatedAtUnix = Math.floor(new Date(config.updatedAt).getTime() / 1000);

  return new EmbedBuilder()
    .setTitle(`${config.displayTitle} — ${monthLabel}`)
    .setDescription(`${progressBar}\n${flavorLine}`)
    .setColor(getEmbedColor(state.percentageFunded))
    .addFields(
      { name: 'Monthly Coverage', value: formatCoverage(state.percentageFunded),              inline: true },
      { name: 'Hours Left',       value: `**${formatHoursLeft(state.displayHoursLeft)}**`,    inline: true },
      { name: 'Last Updated',     value: `<t:${updatedAtUnix}:R>`,                            inline: false },
    )
    .setFooter({ text: 'keeping the lights on — community funded' });
}
