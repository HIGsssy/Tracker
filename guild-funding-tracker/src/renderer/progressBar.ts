/**
 * Renders an ASCII progress bar for a percentage value.
 * Percentage is clamped to 0–100 before rendering.
 *
 * Example: buildProgressBar(65, 20) → '█████████████░░░░░░░'
 */
export function buildProgressBar(percentage: number, width = 20): string {
  const clamped = Math.min(100, Math.max(0, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
