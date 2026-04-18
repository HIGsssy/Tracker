// Shared slash command definition — single source of truth for both the
// deploy-commands script and the optional startup auto-registration.

import { SlashCommandBuilder } from 'discord.js';
import { MIN_HOURLY_COST, MAX_HOURLY_COST } from '../constants/validation';

export const fundingCommand = new SlashCommandBuilder()
  .setName('funding')
  .setDescription('Guild funding tracker commands')
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Set up or reconfigure the funding tracker for this server')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel where the tracker embed will be posted')
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('title')
          .setDescription('Display title for the tracker embed (default: "Server Funding")')
          .setRequired(false),
      )
      .addNumberOption((opt) =>
        opt
          .setName('hourly_cost')
          .setDescription(
            `Hourly server cost in USD (default: 0.06, min: ${MIN_HOURLY_COST}, max: ${MAX_HOURLY_COST})`,
          )
          .setRequired(false)
          .setMinValue(MIN_HOURLY_COST)
          .setMaxValue(MAX_HOURLY_COST),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Record a funding contribution for the current month')
      .addNumberOption((opt) =>
        opt
          .setName('amount')
          .setDescription('Dollar amount (e.g. 12.50)')
          .setRequired(true)
          .setMinValue(0.01),
      )
      .addStringOption((opt) =>
        opt
          .setName('donor_name')
          .setDescription('Optional label for this contribution')
          .setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName('note')
          .setDescription('Optional free-text note')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a specific donation record')
      .addIntegerOption((opt) =>
        opt
          .setName('record_id')
          .setDescription('ID of the donation record to remove')
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('View current funding status'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('set-hourly-cost')
      .setDescription('Update the hourly server cost used for coverage calculations')
      .addNumberOption((opt) =>
        opt
          .setName('cost')
          .setDescription(
            `New hourly cost in USD (min: ${MIN_HOURLY_COST}, max: ${MAX_HOURLY_COST})`,
          )
          .setRequired(true)
          .setMinValue(MIN_HOURLY_COST)
          .setMaxValue(MAX_HOURLY_COST),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('View or update funding tracker configuration')
      .addStringOption((opt) =>
        opt
          .setName('title')
          .setDescription('New display title for the tracker embed')
          .setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName('display_mode')
          .setDescription('Tracker embed display style')
          .setRequired(false)
          .addChoices(
            { name: 'Standard', value: 'standard' },
            { name: 'Minimal', value: 'minimal' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('refresh')
      .setDescription(
        'Force re-render and re-post the tracker embed (use to recover after deletion)',
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reset-month')
      .setDescription("Archive a month's funding state (default: previous month)")
      .addStringOption((opt) =>
        opt
          .setName('month')
          .setDescription('Month to archive in YYYY-MM format (default: previous month)')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('View archived monthly funding summaries')
      .addStringOption((opt) =>
        opt
          .setName('month')
          .setDescription('Specific month to view in YYYY-MM format (default: recent months)')
          .setRequired(false),
      ),
  );
