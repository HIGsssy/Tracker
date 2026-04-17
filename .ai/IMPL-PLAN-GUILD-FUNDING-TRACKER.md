# Guild Funding Tracker — Implementation Plan

> Status: Ready for builder handoff  
> Prepared: 2026-04-17  
> Revised: 2026-04-17 (Rev 2 — terminology clarity, stale-embed refresh, hourly_cost bounds, invariants section)  
> Scope: Standalone Discord bot, v1 manual/admin-driven, no external billing integrations

---

## 1. Executive Summary

Guild Funding Tracker is a standalone, Dockerized Discord bot that lets server admins maintain a monthly funding tracker visible to server members. Admins input dollar amounts; the bot converts those amounts into runtime coverage hours using a configurable hourly cost (default $0.06/hr). The public embed shows **Monthly Coverage** (what fraction of the month's runtime is funded), **Hours Left** (how much funded runtime remains right now), and last-updated time — never raw dollar values or a dollar goal.

The distinction between these two fields is intentional and important: a guild can show 100% Monthly Coverage but only a few Hours Left if it is late in a well-funded month. Keeping them as separate, clearly labeled fields prevents that ambiguity.

Each guild maintains fully independent configuration and funding state. All guild-scoped state lives in a database. Environment variables handle only app-wide secrets and infrastructure defaults. The system is designed to be restartable, resilient to missing Discord messages/channels, and purely manual in v1. An optional low-frequency stale-embed refresh ensures the public message does not appear frozen without introducing timer-based balance mutation or rate-limit risk.

---

## 2. Key Business Rules

| # | Rule |
|---|------|
| BR-1 | Each guild has independent configuration and tracker state. |
| BR-2 | Funding is entered as dollar amounts by admins only. |
| BR-3 | Public display shows Monthly Coverage (%) and Hours Left — never dollar amounts or a dollar goal. |
| BR-4 | Hourly cost defaults to $0.06/hr and is configurable per guild within validated bounds. |
| BR-5 | The funded balance resets to zero at the start of each calendar month. |
| BR-6 | Unused funding does NOT carry over to the next month. |
| BR-7 | Admins manually add next month's funding — no automation in v1. |
| BR-8 | The embed/message is a rendered view of stored state, not the source of truth. |
| BR-9 | Guild-specific config and state are stored in the database, not in env vars. |
| BR-10 | Prior month history is preserved in an archive table after reset. |
| BR-11 | No external payment webhook integrations in v1. |
| BR-12 | Hourly cost must be within validated bounds: minimum $0.001/hr, maximum $1000.00/hr. Values outside this range are rejected at all input points. |
| BR-13 | The posted tracker embed may be refreshed automatically when it is stale (older than a configurable threshold, default 6 hours), triggered only on bot ready or when `/funding status` is called — never on a high-frequency timer. |

---

## 3. Core Design Invariants

> **This section defines non-negotiable architectural rules. A builder must not violate these rules regardless of convenience, performance arguments, or feature pressure. Violating any of these produces a system that is incorrect, fragile, or both.**

---

### INV-1: The database is the single source of truth.

All funding state, configuration, and history lives in SQLite. The Discord embed is a rendered artifact derived from that state. If the embed is deleted, the bot restarts, or the Discord API is unreachable, the authoritative state is unchanged. No value is read back from the embed to make a business decision.

**Concretely:** command handlers write to DB → services compute from DB → renderer builds embed → Discord layer posts/edits. The arrow never reverses.

---

### INV-2: The embed is disposable.

The posted tracker message can be deleted, lost, or re-created at any time without data loss. `tracker_message_id` is a pointer to a rendered view, not a record. If the message is gone, `/funding refresh` re-derives and re-posts it. The calculation and all inputs are in the database.

---

### INV-3: Guild configuration and state live in the database, not in env vars.

Environment variables are for app-wide infrastructure: the bot token, the SQLite path, the default hourly cost used only at row-creation time, log level. Every per-guild setting — hourly cost, channel ID, message ID, admin role, display title — is stored in `guild_tracker_config`. Changing a guild's config never requires restarting the bot or editing env vars.

---

### INV-4: `hours_left` is derived on demand. It is never stored, cached, or decremented on a timer.

The formula is always:

```
hours_left = MAX(0, (total_funded / hourly_cost) - (now - month_start) / 3_600_000)
```

This is evaluated at render time using the current wall clock. There is no background job that mutates a balance column. If the bot is offline for 48 hours and comes back, the first calculation will be exactly correct with no reconciliation needed.

**Any code that writes a decremented balance to the database is a violation of this invariant.**

---

### INV-5: Month reset is emergent, not destructive.

The reset happens automatically because the `month_key` field in every query is derived from the current UTC calendar month. When the month changes, `SUM(amount) WHERE month_key = current_month` naturally returns 0 for a month with no records. No donation records are deleted, overwritten, or moved. No balance field is zeroed. The archive captures a snapshot; the underlying data is never touched.

---

## 4. Canonical Funding Calculation Model

### 4.1 Definitions

```
month_key          := Calendar month identifier, format YYYY-MM (e.g. "2026-04")
                      Derived from UTC wall clock. All month boundaries use UTC.

month_start        := First instant of month_key in UTC
                      e.g. 2026-04-01T00:00:00.000Z

month_end          := First instant of the next month in UTC
                      e.g. 2026-05-01T00:00:00.000Z

month_hours        := (month_end - month_start) in milliseconds / 3_600_000
                      Accounts for actual days in the month (28–31 days).
                      April 2026: 720.0 hours exactly.

total_funded       := SUM(amount) FROM donation_records
                      WHERE guild_id = ? AND month_key = current month_key

funded_hours       := total_funded / hourly_cost
                      Floating point. Not rounded for calculation; rounded only for display.

hours_elapsed      := (NOW() - month_start) / 3_600_000
                      Recalculated dynamically at render time. Never persisted.

hours_left         := MAX(0, funded_hours - hours_elapsed)
                      Derived on demand. Not stored. Naturally reaches 0 when funded hours
                      are exhausted, even without mutation of any stored value.

monthly_coverage   := MIN(100, (funded_hours / month_hours) * 100)
                      The fraction of this month's total runtime that is funded, as a percentage.
                      Capped at 100 — you cannot fund more than 100% of a month.
                      This is the value shown publicly as "Monthly Coverage."
                      Internally represented as percentageFunded in FundingState.
```

### 4.2 Why Two Distinct Public Fields

`monthly_coverage` and `hours_left` answer different questions and must be presented as separate fields. They can diverge in ways that are confusing if only one is shown:

| Scenario | Monthly Coverage | Hours Left | What it means |
|----------|-----------------|-----------|---------------|
| Month fully funded, day 1 | 100% | ~719h | Great — fully funded, month just started |
| Month fully funded, day 29 | 100% | ~24h | Fully funded but almost over |
| Month half funded, day 1 | 50% | ~359h | Half coverage, still early |
| Month half funded, day 15 | 50% | ~-119h → 0h | Half coverage, already run out |

Showing only "100% funded" late in a month would look healthy when runtime has nearly expired. Showing only hours_left obscures whether the month was funded at all. Both fields together give the complete picture.

**The public label "Monthly Coverage" is preferred over "Percentage Funded" or "Funded This Month" because:**
- "Funded This Month" reads as a statement about what has been paid, not about the runtime that is covered.
- A 100% reading late in a month is still 100% coverage — the label is accurate.
- "Monthly Coverage" maps clearly to "how much of this month's runtime is paid for," which is the correct mental model.

### 4.3 Calculation Notes

**Why derive hours_left dynamically?**  
Storing and mutating a balance every hour introduces drift, requires a durable scheduler, and creates recovery complexity after restarts. By storing only `total_funded` and deriving depletion from `(now - month_start)`, the calculation is always correct regardless of downtime. A bot that is offline for 6 hours will show accurate hours_left the moment it comes back up. See INV-4.

**last_updated vs. time-based depletion:**  
`last_updated` is the timestamp when the Discord embed was last edited (stored in `guild_tracker_config.updated_at`). It reflects admin activity and embed refreshes. It has no bearing on the depletion calculation, which is purely `now - month_start`. These are independent.

**Month boundary:**  
When `NOW()` crosses into a new `month_key`, `total_funded` for the new month is 0 until an admin runs `/funding add`. `hours_elapsed` is relative to the new `month_start`. The tracker will immediately show 0% Monthly Coverage, 0 hours left — which is correct, because no funding has been entered yet.

**Example — April 2026:**
```
hourly_cost       = 0.06
total_funded      = 50.00
funded_hours      = 50.00 / 0.06 = 833.33 hours
month_hours       = 720 hours (April = 30 days)
monthly_coverage  = MIN(100, 833.33 / 720 * 100) = 100%   ← capped

hours_elapsed     = 168 hours (7 days in)
hours_left        = MAX(0, 833.33 - 168) = 665.33 hours
```

```
total_funded      = 15.00
funded_hours      = 15.00 / 0.06 = 250 hours
monthly_coverage  = MIN(100, 250 / 720 * 100) = 34.7%

hours_elapsed     = 168 hours
hours_left        = MAX(0, 250 - 168) = 82 hours
```

```
total_funded      = 15.00
funded_hours      = 250 hours
monthly_coverage  = 34.7%

hours_elapsed     = 300 hours (12.5 days in — funding already exhausted)
hours_left        = MAX(0, 250 - 300) = 0 hours
```

The third example is critical: 34.7% monthly coverage but 0 hours left. Both fields must be shown.

### 4.4 Month Reset Mechanics

At the start of a new month:
1. A scheduled job archives the previous month's summary into `month_archive`.
2. No donation records are deleted — they remain with their original `month_key`.
3. The new month's `total_funded` is 0 because no donation records exist for the new `month_key` yet.
4. The tracker embed is refreshed to reflect 0% Monthly Coverage.
5. No data is mutated or deleted. The reset is emergent, not destructive. See INV-5.

The `/funding reset-month` command forces this flow manually (useful if the scheduler misfires or the bot was offline at month boundary).

---

## 5. Recommended Tech Stack

| Concern | Choice | Justification |
|---------|--------|---------------|
| Language/Runtime | TypeScript on Node.js 20 LTS | Best Discord.js support; strong typing prevents calculation bugs; Docker-friendly |
| Discord Library | discord.js v14 | Most mature, best slash command support, well-documented, large community |
| Database | SQLite via `better-sqlite3` | Zero-config, file-based, Docker volume mount, synchronous API simplifies code, appropriate for single-instance bot |
| ORM/Query Builder | `drizzle-orm` with `drizzle-kit` migrations | Type-safe, schema-first, SQLite support, migration CLI, no heavy abstraction |
| Scheduler | `node-cron` | Lightweight, zero dependencies, sufficient for monthly resets |
| Config | `dotenv` + `zod` for env validation | Standard, validated at startup, fails fast on missing required vars |
| Build | `tsc` → `dist/` | No bundler needed; keeps build simple |
| Testing | `vitest` | Fast, TypeScript-native, compatible with Node.js environment |
| Linting | `eslint` + `@typescript-eslint` | Standard quality gate |

**SQLite justification for multi-guild:**  
A single-instance Discord bot with dozens or hundreds of guilds does not need PostgreSQL in v1. SQLite with WAL mode handles concurrent reads without issue. The database is a single file mounted as a Docker volume. If the project ever scales to clustered deployment, the migration path to PostgreSQL is a connection string change plus a schema port — drizzle-orm supports both.

---

## 6. Proposed Application Architecture

```
guild-funding-tracker/
├── src/
│   ├── index.ts                  ← Entry point: load config, init DB, start bot
│   ├── config/
│   │   └── env.ts                ← Env var schema (zod), validated at startup
│   ├── constants/
│   │   └── validation.ts         ← MIN_HOURLY_COST, MAX_HOURLY_COST, STALE_EMBED_THRESHOLD_HOURS
│   ├── db/
│   │   ├── schema.ts             ← Drizzle schema definitions
│   │   ├── client.ts             ← better-sqlite3 + drizzle instance
│   │   └── migrations/           ← Drizzle migration SQL files
│   ├── bot/
│   │   ├── client.ts             ← Discord.js Client setup, intents
│   │   ├── deploy-commands.ts    ← Slash command registration script
│   │   └── events/
│   │       ├── ready.ts          ← On ready: verify tracker messages, stale-embed check
│   │       └── interactionCreate.ts ← Route interactions to handlers
│   ├── commands/
│   │   ├── index.ts              ← Command registry (map name → handler)
│   │   ├── setup.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   ├── status.ts
│   │   ├── setHourlyCost.ts
│   │   ├── config.ts
│   │   ├── refresh.ts
│   │   ├── resetMonth.ts
│   │   └── history.ts
│   ├── services/
│   │   ├── fundingService.ts     ← Business logic: add/remove records, get totals
│   │   ├── calculationService.ts ← Funding math (funded_hours, hours_left, monthly_coverage)
│   │   ├── trackerService.ts     ← Embed post/edit/recovery/stale-refresh orchestration
│   │   └── archiveService.ts     ← Month archival logic
│   ├── renderer/
│   │   ├── embedBuilder.ts       ← Builds EmbedBuilder from calculated state
│   │   └── progressBar.ts        ← ASCII progress bar generator
│   └── scheduler/
│       └── monthlyReset.ts       ← node-cron job for month boundary
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── drizzle.config.ts
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

### Data Flow (canonical)

```
Admin command
    ↓
Command Handler (validate input, check permissions)
    ↓
FundingService / Config mutation (DB write)
    ↓
CalculationService.compute(guild_id) → { funded_hours, hours_left, percentageFunded, month_hours, ... }
    ↓
EmbedBuilder.build(config, calculatedState) → EmbedBuilder
  (percentageFunded rendered as "Monthly Coverage" label)
    ↓
TrackerService.postOrEdit(guild_id, embed) → edits existing message or creates new one
    ↓
GuildTrackerConfig.updated_at refreshed in DB
```

The command handler never touches Discord message APIs directly. It delegates to `TrackerService`, which handles create-vs-edit and recovery.

---

## 7. Module Breakdown

### 7.1 `config/env.ts`

Parses and validates all environment variables at startup using zod. Exports a typed `AppConfig` object. If any required var is missing or invalid, the process exits with a clear error before the bot connects.

**Env vars handled here (NOT guild-specific):**
- `DISCORD_TOKEN` — bot token (required)
- `DISCORD_CLIENT_ID` — application ID for command registration (required)
- `DATABASE_PATH` — path to SQLite file (default: `/data/tracker.db`)
- `DEFAULT_HOURLY_COST` — app-wide default used at row-creation time (default: `0.06`; must pass MIN/MAX bounds validation)
- `STALE_EMBED_THRESHOLD_HOURS` — hours before a posted tracker embed is considered stale and eligible for refresh (default: `6`)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error` (default: `info`)
- `NODE_ENV` — `development` | `production`

### 7.2 `constants/validation.ts`

A single source of truth for input bounds. Import these constants in command handlers, the service layer, and anywhere that validates `hourly_cost`.

```typescript
export const MIN_HOURLY_COST = 0.001;   // below this, funded_hours become astronomically large
export const MAX_HOURLY_COST = 1000.00; // above this, no realistic guild would ever fund

export const MIN_DONATION_AMOUNT = 0.01;
export const MAX_DONATION_AMOUNT = 100_000.00; // soft warn at 10k, hard block at 100k

export const STALE_EMBED_DEFAULT_THRESHOLD_HOURS = 6;
```

These constants exist here — not inline in handlers — so a single change propagates everywhere.

### 7.3 `db/`

`schema.ts` — Drizzle table definitions (see Section 8).  
`client.ts` — Opens the SQLite file, enables WAL mode, exports the drizzle instance.  
`migrations/` — SQL files generated by `drizzle-kit generate`. Applied at startup via `drizzle-kit migrate` or programmatically on boot.

### 7.4 `bot/client.ts`

Creates the `discord.js` `Client` with minimal required intents:
- `Guilds` — for guild join/leave events and guild data
- `GuildMessages` — not strictly required for slash commands; include only if needed for future message-based features

No message content intent needed. All interaction is slash-command-based.

### 7.5 `bot/events/ready.ts`

On bot ready:
1. Log connected guilds.
2. For each guild with `enabled = true` in `guild_tracker_config`: verify `tracker_message_id` still exists in `tracker_channel_id`.
3. If the message is missing or the channel is missing: clear `tracker_message_id` in DB, log a warning. Do not crash. Admin must run `/funding refresh` to recover.
4. For each guild that passed step 2: call `trackerService.refreshIfStale(guild_id)`. This checks whether `updated_at` is older than `STALE_EMBED_THRESHOLD_HOURS`. If stale, trigger a full refresh. See Section 7.7 for the stale-refresh contract.

### 7.6 `services/calculationService.ts`

Pure functions. No Discord dependency. No DB access. Receives data, returns computed values.

```typescript
interface FundingInputs {
  totalFunded: number;    // sum of donation_records for month
  hourlyCost: number;     // from guild config
  nowUtc: Date;           // injectable for testing
}

interface FundingState {
  monthKey: string;
  monthHours: number;
  fundedHours: number;
  hoursElapsed: number;
  hoursLeft: number;
  percentageFunded: number;  // 0–100; rendered publicly as "Monthly Coverage"
  isFullyFunded: boolean;
}

function computeFundingState(inputs: FundingInputs): FundingState
function getMonthBounds(monthKey: string): { start: Date; end: Date }
function getMonthHours(monthKey: string): number
function getCurrentMonthKey(now: Date): string
```

Note: `percentageFunded` is the internal field name throughout service and calculation code. The public-facing label "Monthly Coverage" is applied only in `embedBuilder.ts`. The separation prevents label-driven confusion from bleeding into business logic.

### 7.7 `services/trackerService.ts`

Orchestrates the full render + post/edit cycle.

- `refreshTracker(guild_id)`:
  1. Load config from DB. If `enabled = false` or no channel configured, return early.
  2. Load `total_funded` for current month via `fundingService`.
  3. Compute state via `calculationService`.
  4. Build embed via `embedBuilder`.
  5. If `tracker_message_id` exists: attempt to edit. On `Unknown Message` or `Unknown Channel` error: fall through to create.
  6. If creating: post new message to `tracker_channel_id`, store returned message ID in DB.
  7. Update `updated_at` in `guild_tracker_config`.

- `refreshIfStale(guild_id)`:
  1. Load config from DB. If `enabled = false`, no channel, or no `tracker_message_id`: return early (nothing to refresh).
  2. Compute `hoursAgo = (now - updated_at) / 3_600_000`.
  3. If `hoursAgo < STALE_EMBED_THRESHOLD_HOURS`: return early (not stale).
  4. Call `refreshTracker(guild_id)`.
  5. Log: "Refreshed stale tracker for guild [id] (was [hoursAgo]h old)."

  `refreshIfStale` does **not** run on a timer. It is called from exactly two places:
  - `ready.ts` — on bot startup, once per enabled guild.
  - `/funding status` command handler — after building its ephemeral response.

  This means the embed refreshes at most once per bot restart or once per status invocation per guild. There is no polling loop, no background interval, and no Discord rate-limit risk.

- `deleteTracker(guild_id)`: attempts to delete the tracked message; clears `tracker_message_id` in DB regardless of Discord result.

### 7.8 `services/fundingService.ts`

DB-backed service. All queries are scoped by `guild_id`.

- `addDonation(guild_id, amount, createdByUserId, donorName?, note?) → DonationRecord`
- `removeDonation(guild_id, recordId) → boolean` (validates guild_id ownership before delete)
- `getMonthTotal(guild_id, monthKey) → number`
- `getMonthRecords(guild_id, monthKey) → DonationRecord[]`
- `getGuildConfig(guild_id) → GuildTrackerConfig | null`
- `upsertGuildConfig(guild_id, partial) → GuildTrackerConfig`

The service must validate `hourly_cost` against `MIN_HOURLY_COST` / `MAX_HOURLY_COST` from `constants/validation.ts` whenever it is written. This is a defense-in-depth check — the command handler validates first, the service validates again before the DB write.

```typescript
function validateHourlyCost(value: number): void {
  if (!Number.isFinite(value) || value < MIN_HOURLY_COST || value > MAX_HOURLY_COST) {
    throw new ValidationError(
      `Hourly cost must be between $${MIN_HOURLY_COST} and $${MAX_HOURLY_COST}.`
    );
  }
}
```

### 7.9 `services/archiveService.ts`

- `archiveMonth(guild_id, monthKey)`:
  1. Compute final funding state for that month.
  2. Insert into `month_archive` (upsert — safe to call multiple times).
  3. Does NOT delete donation records.

- `archiveAllGuildsForMonth(monthKey)`: iterates all enabled guilds, calls `archiveMonth`.

### 7.10 `renderer/embedBuilder.ts`

Accepts `GuildTrackerConfig` + `FundingState`, returns a `discord.js EmbedBuilder`.

No Discord API calls. Pure data-in, embed-out.

**This is the only place where `percentageFunded` is mapped to the user-visible label "Monthly Coverage."**

Fields:
- Title: `config.display_title` + current month (e.g. "Server Funding — April 2026")
- Description: optional progress bar line
- Fields: **Monthly Coverage** (from `percentageFunded`), **Hours Left**, **Last Updated**
- Footer: optional status label
- Color: green (≥75%), yellow (25–74%), red (<25%)

### 7.11 `scheduler/monthlyReset.ts`

Registers a `node-cron` job: `0 1 1 * *` (00:01 UTC on 1st of every month).

On fire:
1. Determine the month that just ended (`previous month_key`).
2. Call `archiveAllGuildsForMonth(previousMonthKey)`.
3. Call `trackerService.refreshTracker(guild_id)` for all enabled guilds (shows 0% Monthly Coverage for new month).
4. Optionally post a reset notification to a configured admin channel (future: `admin_notification_channel_id` field in config).
5. Log completion.

`00:01` instead of `00:00` gives Discord's clocks a moment to settle and avoids any sub-second boundary ambiguity.

---

## 8. Database Schema Proposal

### 8.1 `guild_tracker_config`

```sql
CREATE TABLE guild_tracker_config (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id                TEXT    NOT NULL UNIQUE,
  enabled                 INTEGER NOT NULL DEFAULT 0,          -- 0=false, 1=true
  tracker_channel_id      TEXT,                                -- NULL until setup
  tracker_message_id      TEXT,                                -- NULL until first post
  hourly_cost             REAL    NOT NULL DEFAULT 0.06
                          CHECK (hourly_cost >= 0.001 AND hourly_cost <= 1000.0),
  display_title           TEXT    NOT NULL DEFAULT 'Server Funding',
  public_display_mode     TEXT    NOT NULL DEFAULT 'standard', -- 'standard' | 'minimal'
  hide_public_dollar_values INTEGER NOT NULL DEFAULT 1,        -- always 1 in v1; reserved for future
  admin_role_id           TEXT,                                -- optional: role allowed to use admin commands
  created_at              TEXT    NOT NULL,                    -- ISO8601 UTC
  updated_at              TEXT    NOT NULL                     -- ISO8601 UTC; refreshed on every embed update
);
```

**Field notes:**
- `guild_id`: Discord snowflake string. TEXT not INTEGER because Discord snowflakes exceed SQLite integer precision.
- `tracker_message_id`: nullable. Null means no embed posted yet, or embed was lost and needs recovery.
- `hourly_cost`: per-guild value. Defaults to `DEFAULT_HOURLY_COST` env var at row creation time (snapshot, not live reference to env). The `CHECK` constraint enforces the same bounds as `constants/validation.ts` at the database level — a second line of defense against invalid values reaching the DB from any code path.
- `public_display_mode`: reserved for future layout variants. `'standard'` in v1 shows progress bar + all fields.
- `hide_public_dollar_values`: always `1` in v1 (enforced in renderer). Field exists to enable future optional config without a schema migration.
- `admin_role_id`: if set, slash command permission checks allow this role in addition to MANAGE_GUILD.
- `updated_at`: updated whenever `refreshTracker` completes successfully. Used by `refreshIfStale` to determine embed age. Shown in embed as "Last Updated."

### 8.2 `donation_record`

```sql
CREATE TABLE donation_record (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT    NOT NULL,
  month_key         TEXT    NOT NULL,   -- YYYY-MM
  amount            REAL    NOT NULL
                    CHECK (amount > 0),
  recorded_at       TEXT    NOT NULL,   -- ISO8601 UTC timestamp of data entry
  donor_name        TEXT,               -- optional, admin-provided label
  note              TEXT,               -- optional, admin-provided note
  created_by_user_id TEXT   NOT NULL    -- Discord user snowflake of admin who entered this
);

CREATE INDEX idx_donation_guild_month ON donation_record (guild_id, month_key);
```

**Field notes:**
- `month_key` is set explicitly at insert time as `getCurrentMonthKey(now)`. It is not derived from `recorded_at` at query time — this prevents a record entered at 23:59 from ambiguously straddling months if there's clock skew.
- `recorded_at` is the wall-clock time of data entry (when the admin ran `/funding add`).
- `amount` must be > 0. Validated in command handler and service layer before reaching DB. The `CHECK` constraint is a final backstop.
- No `deleted_at` soft-delete in v1. `/funding remove` hard-deletes after confirming `guild_id` ownership.

**How current month total is determined:**
```sql
SELECT COALESCE(SUM(amount), 0)
FROM donation_record
WHERE guild_id = ? AND month_key = ?
```
Total is always derived, never denormalized. The amount of data per guild per month is small (likely < 100 records ever), so a SUM query is negligible.

### 8.3 `month_archive`

```sql
CREATE TABLE month_archive (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id                TEXT    NOT NULL,
  month_key               TEXT    NOT NULL,               -- YYYY-MM
  total_funded            REAL    NOT NULL,
  hourly_cost_snapshot    REAL    NOT NULL,               -- cost at time of archive
  funded_hours            REAL    NOT NULL,
  month_hours             REAL    NOT NULL,
  percentage_funded       REAL    NOT NULL,               -- final monthly_coverage %, capped at 100
  finalized_at            TEXT    NOT NULL,               -- ISO8601 UTC
  UNIQUE (guild_id, month_key)
);
```

**Purpose:** Preserves a snapshot of final funding state for each month after reset. Allows `/funding history` to show prior months without re-querying donation_records (though those remain available too). The `UNIQUE` constraint makes archiving idempotent — running it twice for the same guild+month is safe. The column is named `percentage_funded` (a number) in the DB; it maps to "Monthly Coverage" in display contexts.

---

## 9. Discord Command Plan

### 9.1 Command Registration

Commands are registered as guild commands (not global) during initial setup. Use `deploy-commands.ts` as a one-shot script: `node dist/bot/deploy-commands.js --guild-id=<ID>` or register globally via `--global` flag.

Global command propagation takes up to 1 hour. Guild commands propagate instantly. For v1, recommend per-guild registration during setup, with a global registration option for production rollout.

### 9.2 Permissions Model

All `/funding` subcommands except `status` are admin-only.

**Admin check logic (in each admin handler):**
```
1. If member has MANAGE_GUILD permission → allow.
2. Else if guild_tracker_config.admin_role_id is set AND member has that role → allow.
3. Else → reject with ephemeral "You do not have permission to use this command."
```

`/funding status` is available to all members (returns ephemeral response).

### 9.3 Command Definitions

---

#### `/funding setup`
**Purpose:** First-time configuration. Creates the guild config row and posts the initial tracker embed.

**Options:**
- `channel` (required): Channel mention or ID where tracker embed will be posted.
- `title` (optional): Display title for the embed. Default: "Server Funding".
- `hourly_cost` (optional): Override default hourly cost. Default: env `DEFAULT_HOURLY_COST`.

**Behavior:**
1. Check if `guild_tracker_config` row exists for this guild.
2. If it exists and `enabled = true`: respond ephemeral "Tracker is already set up. Use `/funding config` to change settings or `/funding refresh` to re-post the embed."
3. Validate channel is a text channel the bot can send messages to. If not, reject with clear error.
4. Create/update config row with `enabled = true`.
5. Call `trackerService.refreshTracker(guild_id)` → posts embed.
6. Respond ephemeral: "Tracker set up in #channel. Use `/funding add` to record this month's funding."

**Validation:**
- `hourly_cost` must be between `MIN_HOURLY_COST` ($0.001) and `MAX_HOURLY_COST` ($1000.00) if provided. Reject with: "Hourly cost must be between $0.001 and $1000.00."
- Channel must be accessible and a text channel.

---

#### `/funding add`
**Purpose:** Record a funding contribution for the current month.

**Options:**
- `amount` (required): Dollar amount. Decimal accepted (e.g., 12.50).
- `donor_name` (optional): Label for this contribution.
- `note` (optional): Free-text note.

**Behavior:**
1. Validate amount > 0. Reject: "Amount must be greater than 0."
2. Insert `donation_record` with `month_key = getCurrentMonthKey(now)`.
3. Call `trackerService.refreshTracker(guild_id)`.
4. Respond ephemeral: "Added $12.50 to April 2026 funding. Tracker updated."

**Validation:**
- amount must be a positive finite number.
- amount > $10,000 produces a warning but is not blocked (admin confirms).

---

#### `/funding remove`
**Purpose:** Remove a specific donation record.

**Options:**
- `record_id` (required): Integer ID of the record to remove.

**Behavior:**
1. Look up record by `id` WHERE `guild_id = ?` (ownership check enforced in query).
2. If not found: "Record #ID not found for this server."
3. Confirm deletion (ephemeral message with "Confirm" button, 30-second timeout). On timeout: "Cancelled."
4. On confirm: delete record, call `trackerService.refreshTracker(guild_id)`.
5. Respond: "Record #ID removed. Tracker updated."

**Note:** Use an ephemeral confirmation with a Discord button component. Do not require a separate confirmation command.

---

#### `/funding status`
**Purpose:** Show current funding status. Available to all members.

**Options:** none.

**Behavior:**
1. Load config. If `enabled = false` or no config: "Funding tracker is not configured for this server."
2. Compute funding state.
3. Return ephemeral embed with full details:
   - **Monthly Coverage** (%) and **Hours Left** as labeled fields.
   - For admins only: also show total funded ($X.XX), hourly cost, number of records this month.
4. After sending the ephemeral response, call `trackerService.refreshIfStale(guild_id)` (fire-and-forget, do not await in the response path — log errors only).
5. Not the same as the posted tracker — this is a fresh ephemeral view.

**Why trigger stale-refresh here:** `/funding status` is the most natural point at which someone is looking at the tracker. If the embed is stale, refreshing it at this moment is appropriate and low-frequency. The refresh happens after the ephemeral response so it does not delay the user's feedback.

---

#### `/funding set-hourly-cost`
**Purpose:** Update the per-guild hourly cost.

**Options:**
- `cost` (required): New hourly cost in dollars.

**Behavior:**
1. Validate: `MIN_HOURLY_COST ≤ cost ≤ MAX_HOURLY_COST`. Reject with: "Hourly cost must be between $0.001 and $1000.00."
2. Update `guild_tracker_config.hourly_cost`.
3. Refresh tracker.
4. Respond ephemeral: "Hourly cost updated to $0.08/hr. Tracker recalculated."

**Note:** Changing hourly_cost retroactively changes the meaning of all existing donation records for the current month — this is intentional and correct. The admin controls the rate. The implication (monthly coverage and hours_left both change) is reflected immediately in the refreshed embed.

---

#### `/funding config`
**Purpose:** View and update configuration settings.

**Options (all optional):**
- `title` (string): Update display title.
- `admin_role` (role): Set the admin role.
- `display_mode` (choice): `standard` | `minimal`.

**With no options:** Display current config as ephemeral embed showing all settings.  
**With options:** Update specified fields, respond with confirmation.

---

#### `/funding refresh`
**Purpose:** Force re-render and re-post/edit the tracker embed. Primary recovery mechanism.

**Options:** none.

**Behavior:**
1. Call `trackerService.refreshTracker(guild_id)`.
2. If tracker message was missing and had to be re-created: "Tracker message was missing and has been re-posted in #channel."
3. If edited in place: "Tracker refreshed."
4. Used for recovery after message deletion, channel changes, or bot downtime.

---

#### `/funding reset-month`
**Purpose:** Manually trigger the end-of-month archive and reset. Intended for manual recovery if the scheduler misfired or the bot was offline at month boundary.

**Options:**
- `month` (optional): YYYY-MM of the month to archive. Defaults to the previous calendar month.

**Behavior:**
1. Show confirmation: "This will archive [month] for this server and show 0% Monthly Coverage for the new month. This cannot be undone. Confirm?"
2. On confirm:
   - Call `archiveService.archiveMonth(guild_id, monthKey)`.
   - Call `trackerService.refreshTracker(guild_id)` (new month = 0% Monthly Coverage).
3. Respond: "Month [YYYY-MM] archived. Tracker reset for new month."

**Note:** This command operates on the archive table. It does not delete donation records. Running it multiple times is safe (upsert in archive).

---

#### `/funding history`
**Purpose:** View summary of past months.

**Options:**
- `month` (optional): YYYY-MM. If omitted, show last 3 months.

**Behavior:**
1. Query `month_archive` for the guild.
2. Return ephemeral embed with: month, total funded, funded hours, final Monthly Coverage (%), finalized date.
3. If no archive exists for a month: "No archive found for [month]."

---

### 9.4 Command Error Handling

All command handlers must:
- Defer the interaction with `interaction.deferReply({ ephemeral: true })` immediately (prevents "This interaction failed" from Discord's 3-second timeout).
- Wrap execution in a try/catch. On unhandled error: respond with "Something went wrong. Please try again or contact the bot admin." and log the full error server-side.
- Never expose stack traces to Discord.

---

## 10. Embed Rendering Plan

### 10.1 Standard Mode Layout

```
┌─────────────────────────────────────────────────┐
│ Server Funding — April 2026                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│ ██████████████░░░░░░░░ 65%                       │
│                                                  │
│ Monthly Coverage     Hours Left                  │
│ 65%                  387h 42m                    │
│                                                  │
│ Last Updated                                     │
│ <t:1713456789:R>  (Discord relative timestamp)   │
│                                                  │
│ ─────────────────────────────────────────────── │
│ Running on community support                     │
└─────────────────────────────────────────────────┘
Color: Yellow (25–74%)
```

### 10.2 Field Semantics in the Embed

The two primary fields answer different questions and are always shown together:

| Field | What it answers | Example |
|-------|----------------|---------|
| **Monthly Coverage** | "What fraction of this month's total runtime is funded?" | 65% — funded hours cover 65% of a 720-hour month |
| **Hours Left** | "How much funded runtime is remaining right now?" | 387h 42m — coverage has not yet run out |

A user who understands only one field can be misled. A user who sees both immediately understands the funding posture. The embed layout must always show both fields with equal visual weight — do not collapse one into a subtitle or footnote.

### 10.3 Progress Bar (`renderer/progressBar.ts`)

```typescript
function buildProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
// 65% at width 20: "█████████████░░░░░░░"
```

The progress bar visually represents Monthly Coverage (not hours_left, which has a different scale).

### 10.4 Color Coding

Color reflects Monthly Coverage (`percentageFunded`):

| Coverage | Color (hex) | Meaning |
|----------|-------------|---------|
| ≥ 75% | `#57F287` (green) | Well funded |
| 25–74% | `#FEE75C` (yellow) | Partially funded |
| < 25% | `#ED4245` (red) | Low/unfunded |
| 0% | `#ED4245` (red) | Not funded |

### 10.5 Hours Left Formatting

```typescript
function formatHoursLeft(hoursLeft: number): string {
  if (hoursLeft <= 0) return "0h 0m";
  const h = Math.floor(hoursLeft);
  const m = Math.floor((hoursLeft - h) * 60);
  return `${h}h ${m}m`;
}
```

### 10.6 "Last Updated" Field

Uses Discord's dynamic timestamp format: `<t:UNIX_SECONDS:R>` (renders as "3 hours ago" and auto-updates in the client). The Unix timestamp is derived from `guild_tracker_config.updated_at`.

This timestamp reflects when the embed was last edited, not when a donation was last entered. Both are meaningful but different. If the embed is stale and is refreshed via `refreshIfStale`, `updated_at` is updated to now even if no funding data changed.

### 10.7 Status Label

The footer shows a configurable status label. In v1 this is a static string from `guild_tracker_config.display_title` or a hardcoded "Running on community support." Future: computed label based on funding level.

### 10.8 Message Ownership

The bot posts the embed as a plain message containing only the embed. No companion text. The message ID is stored in `tracker_message_id`. On refresh, the bot edits that message. If the message is gone, it posts a new one and stores the new ID.

The bot should not manage permissions on the channel. If it can't post, it logs the error and marks `tracker_message_id` as null so the admin knows to run `/funding refresh` after fixing channel permissions.

---

## 11. Month Reset / Archive Strategy

### 11.1 Automatic Reset (Scheduler)

`node-cron` job: `0 1 1 * *` (00:01 UTC, 1st of every month)

```
For each guild WHERE enabled = 1:
  1. Determine previousMonthKey (the month that just ended)
  2. Call archiveService.archiveMonth(guild_id, previousMonthKey)
  3. Call trackerService.refreshTracker(guild_id)
     → total_funded for new month = 0 → embed shows 0% Monthly Coverage
  4. Log success or failure per guild (failures are isolated, do not stop other guilds)
```

### 11.2 No Carryover Enforcement

Carryover is structurally impossible in this design:
- `total_funded` is always computed as `SUM(amount) WHERE guild_id=? AND month_key=?`.
- The `month_key` changes automatically when the calendar month changes.
- No code path moves or copies donation records from one month_key to another.
- There is no "balance" field that could accumulate.

See INV-5.

### 11.3 Archive is Read-Only History

`month_archive` rows are never mutated after creation. They are write-once snapshots. If `/funding reset-month` is run multiple times for the same guild+month, the `UNIQUE (guild_id, month_key)` constraint with an `INSERT OR REPLACE` (upsert) refreshes the snapshot — this is safe because we're just re-computing the same data.

### 11.4 Bot Offline at Month Boundary

If the bot is offline when the cron would fire:
- `node-cron` does **not** catch up on missed firings after restart.
- On `ready` event: check if the current `month_key` differs from what would have been archived at last run. If so, trigger the archive for any months that were missed.
- Practical implementation: on `ready`, for each enabled guild, check if `month_archive` has a row for the previous month. If not, archive it.
- This handles the bot being offline over a month boundary.

```typescript
// In ready.ts
async function recoverMissedArchives(guildId: string) {
  const prevMonthKey = getPreviousMonthKey(new Date());
  const existing = await db.query.monthArchive.findFirst({
    where: (t, { and, eq }) => and(eq(t.guildId, guildId), eq(t.monthKey, prevMonthKey))
  });
  if (!existing) {
    await archiveService.archiveMonth(guildId, prevMonthKey);
    logger.info(`Recovered missed archive for guild ${guildId} month ${prevMonthKey}`);
  }
}
```

---

## 12. Docker / Environment Plan

### 12.1 Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
VOLUME /data
CMD ["node", "dist/index.js"]
```

Multi-stage: builder compiles TypeScript, runtime has only production deps. The `/data` volume holds the SQLite database file.

### 12.2 `docker-compose.yml` (production)

```yaml
version: "3.9"
services:
  guild-funding-tracker:
    image: guild-funding-tracker:latest
    restart: unless-stopped
    env_file: .env
    volumes:
      - tracker_data:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  tracker_data:
    driver: local
```

### 12.3 `docker-compose.dev.yml` (local development)

```yaml
version: "3.9"
services:
  guild-funding-tracker:
    build:
      context: .
      dockerfile: Dockerfile
      target: builder        # use builder stage for hot reload
    command: npx tsx watch src/index.ts
    env_file: .env.local
    volumes:
      - ./src:/app/src:ro
      - tracker_data_dev:/data
    environment:
      - NODE_ENV=development

volumes:
  tracker_data_dev:
```

Development uses `tsx watch` for hot reload without a compilation step.

### 12.4 `.env.example`

```env
# Required
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here

# Optional overrides
DATABASE_PATH=/data/tracker.db
DEFAULT_HOURLY_COST=0.06
STALE_EMBED_THRESHOLD_HOURS=6
LOG_LEVEL=info
NODE_ENV=production
```

### 12.5 Database Migration on Startup

In `src/index.ts`, before connecting the Discord client:

```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
migrate(db, { migrationsFolder: './dist/db/migrations' });
```

Drizzle's migrator is idempotent — safe to run on every startup. Ensures the schema is always current without requiring a manual migration step in CI/CD.

### 12.6 Data Persistence

The SQLite file at `DATABASE_PATH` (default `/data/tracker.db`) must be on a named Docker volume or bind mount to survive container restarts and re-deploys. Loss of this file means loss of all guild configs and donation history. **Backup the volume.** For v1, document a simple backup procedure (copy the `.db` file).

---

## 13. Failure Recovery / Operational Safety

### 13.1 Missing Tracker Message

**Scenario:** Admin deletes the tracker message manually, or it's auto-deleted by another bot or moderation tool.

**Detection:** On `ready`, the bot attempts to fetch `tracker_message_id` for each enabled guild. If `Unknown Message` (error 10008) is returned, it clears `tracker_message_id` to null in DB and logs a warning.

**Recovery:** Admin runs `/funding refresh` → `trackerService` sees `tracker_message_id = null` → posts new message → stores new ID.

### 13.2 Missing Tracker Channel

**Scenario:** Channel is deleted.

**Detection:** On `ready` or on `refreshTracker`, `Unknown Channel` (error 10003) is caught.

**Recovery:** Clear `tracker_channel_id` and `tracker_message_id` in DB. Bot responds to all admin commands with "Tracker channel is missing. Run `/funding setup` to reconfigure." Admin runs `/funding setup` with a new channel.

### 13.3 Bot Restart

All state is in SQLite. On restart:
1. Migrations run (idempotent).
2. `ready` event fires: validate message/channel existence per guild; recover missed archives; run stale-embed refresh for each guild whose embed is older than `STALE_EMBED_THRESHOLD_HOURS`.
3. Calculation state is derived from stored data + current time. No in-memory state is lost.

No restart recovery command needed. The bot self-heals on next interaction or `/funding refresh`.

### 13.4 Missing Permissions

If the bot loses permission to send messages or edit messages in the tracker channel:
- Log the Discord error (Missing Permissions, code 50013).
- Do not crash.
- Do not clear `tracker_message_id` (the message still exists; permissions may be restored).
- Surface error to the command invoker if command-triggered: "Could not update tracker: missing permissions in #channel."

### 13.5 Duplicate Guild Config Creation

`guild_id` is `UNIQUE` in `guild_tracker_config`. The service uses `INSERT OR REPLACE` / upsert semantics. Two concurrent `/funding setup` calls cannot create duplicate rows.

### 13.6 Calculation Edge Cases

| Scenario | Behavior |
|----------|----------|
| `total_funded = 0` | `funded_hours = 0`, `hours_left = 0`, `monthly_coverage = 0%`. Valid. |
| `hourly_cost < MIN_HOURLY_COST` | Rejected at command handler and service layer. DB CHECK constraint as final backstop. |
| `hourly_cost > MAX_HOURLY_COST` | Rejected at command handler and service layer. DB CHECK constraint as final backstop. |
| `hourly_cost = 0` | Structurally prevented by MIN_HOURLY_COST = 0.001. No division by zero possible if constraints hold. |
| `funded_hours > month_hours` | `monthly_coverage = 100%` (capped). `hours_left` may still be > 0. Both are correct. |
| `hours_elapsed > funded_hours` | `hours_left = 0` (floored). Correct — coverage has run out. Monthly Coverage may still show > 0%. |
| Bot offline for 30 days | On reconnect, current month is correct, archive recovery fires for missed month. |

### 13.7 Stale Embed Refresh Failure

If `refreshIfStale` is called and the Discord edit fails (rate limit, permissions, etc.):
- Log the error.
- Do not update `updated_at` — the next `refreshIfStale` call will try again.
- Do not surface the failure to the user in the `/funding status` response (the ephemeral status was already sent).

Rate-limit risk is low because `refreshIfStale` is gated by `STALE_EMBED_THRESHOLD_HOURS`. Even if `/funding status` is called 100 times per hour, only one edit per guild per `threshold_hours` will reach the Discord API.

---

## 14. Testing Strategy

### 14.1 Unit Tests — `calculationService.ts`

All calculation logic is pure functions with an injectable `nowUtc` parameter. No mocks needed.

Test cases:
- Standard funding (partial, full, overfunded, zero).
- `hours_left` floor at 0.
- `percentageFunded` cap at 100 (Monthly Coverage cap).
- `month_hours` accuracy for each month length (28, 29, 30, 31 days).
- `getCurrentMonthKey` boundary: last second of month, first second of next month.
- February in leap year vs non-leap year.
- Coverage exhausted (hours_elapsed > funded_hours) shows 0 hours_left but non-zero coverage.

### 14.2 Unit Tests — `renderer/embedBuilder.ts`

Test that given a `FundingState` and `GuildTrackerConfig`, the embed contains:
- Field named "Monthly Coverage" (not "Percentage Funded" or "Funded This Month").
- Field named "Hours Left".
- Correct progress bar string.
- Correct embed color for each coverage tier.

No Discord API call — just inspect the `EmbedBuilder` output.

### 14.3 Unit Tests — `constants/validation.ts` + hourly_cost validation

- `validateHourlyCost(0)` → throws.
- `validateHourlyCost(0.0009)` → throws (below MIN).
- `validateHourlyCost(0.001)` → passes.
- `validateHourlyCost(1000.00)` → passes.
- `validateHourlyCost(1000.01)` → throws (above MAX).
- `validateHourlyCost(NaN)` → throws.
- `validateHourlyCost(Infinity)` → throws.

### 14.4 Integration Tests — `fundingService.ts`

Use an in-memory SQLite database (`:memory:`) seeded with test fixtures. Test:
- `addDonation` and retrieval.
- `getMonthTotal` returns correct sum for guild+month.
- `removeDonation` enforces guild_id ownership (cannot remove another guild's record).
- Upsert behavior for `upsertGuildConfig`.
- `upsertGuildConfig` with `hourly_cost` outside bounds throws `ValidationError` (service-layer guard).
- DB CHECK constraint fires if service-layer guard is bypassed (write raw SQL, verify SQLite rejects it).

### 14.5 Integration Tests — `archiveService.ts`

Test `archiveMonth` with known donation records. Verify `month_archive` row contains correct computed values. Test idempotency (run twice, row updated not duplicated).

### 14.6 Unit Tests — `trackerService.refreshIfStale`

Mock the Discord client and `fundingService`. Test:
- Embed updated_at within threshold → `refreshTracker` not called.
- Embed updated_at beyond threshold → `refreshTracker` called once.
- `tracker_message_id = null` → `refreshIfStale` returns early without calling `refreshTracker`.
- `enabled = false` → returns early.

### 14.7 Command Handler Tests

Test each handler in isolation. Mock:
- The Discord `ChatInputCommandInteraction` (provide `.options.get()`, `.deferReply()`, `.editReply()` stubs).
- `fundingService` (injected dependency or vitest mock).
- `trackerService.refreshTracker`.

Verify: correct service calls, correct response messages, permission rejection behavior.  
For `/funding status`: verify `refreshIfStale` is called after the response is sent.  
For `/funding set-hourly-cost`: verify values outside MIN/MAX are rejected before any service call.

### 14.8 Not Tested in v1

- Live Discord API calls.
- End-to-end bot interaction.
- Docker container behavior.

### 14.9 Test File Colocation

```
src/constants/__tests__/validation.test.ts
src/services/__tests__/calculationService.test.ts
src/services/__tests__/fundingService.test.ts
src/services/__tests__/archiveService.test.ts
src/services/__tests__/trackerService.refreshIfStale.test.ts
src/renderer/__tests__/embedBuilder.test.ts
src/commands/__tests__/add.test.ts
src/commands/__tests__/setup.test.ts
src/commands/__tests__/setHourlyCost.test.ts
src/commands/__tests__/status.test.ts
...
```

---

## 15. Phase-by-Phase Delivery Plan

### Phase 1 — Scaffold & Infrastructure (Foundation)
- [ ] Initialize repo: `npm init`, TypeScript config, ESLint, Vitest config.
- [ ] `config/env.ts`: zod-validated env parsing including `STALE_EMBED_THRESHOLD_HOURS`; startup failure on missing vars.
- [ ] `constants/validation.ts`: `MIN_HOURLY_COST`, `MAX_HOURLY_COST`, `STALE_EMBED_DEFAULT_THRESHOLD_HOURS`.
- [ ] `db/schema.ts`: all three tables defined, including `hourly_cost` CHECK constraint.
- [ ] `db/client.ts`: better-sqlite3 + drizzle, WAL mode enabled.
- [ ] First drizzle migration generated and applied.
- [ ] `bot/client.ts`: Discord client created, no events handled yet.
- [ ] `src/index.ts`: env load → DB migrate → Discord login.
- [ ] Dockerfile + docker-compose.yml functional, bot connects and logs "Ready".
- [ ] `.env.example` committed.

**Exit criterion:** Bot connects to Discord, database file created with correct schema including CHECK constraints.

---

### Phase 2 — Calculation Engine
- [ ] `services/calculationService.ts`: all pure functions implemented.
- [ ] `renderer/progressBar.ts` and `renderer/embedBuilder.ts` implemented with "Monthly Coverage" and "Hours Left" field labels.
- [ ] Unit tests for calculation service (all edge cases including exhausted coverage with non-zero monthly_coverage).
- [ ] Unit tests for embed builder (verify field labels match spec).
- [ ] Unit tests for `constants/validation.ts` hourly_cost bounds.

**Exit criterion:** Given mock data, calculation produces correct values. Embed uses correct field labels. Bounds validation tests pass.

---

### Phase 3 — `/funding setup` + First Embed
- [ ] `services/fundingService.ts`: `getGuildConfig`, `upsertGuildConfig` (with hourly_cost validation).
- [ ] `services/trackerService.ts`: `refreshTracker` (post path only).
- [ ] `/funding setup` command handler (with hourly_cost bounds validation).
- [ ] `bot/events/interactionCreate.ts` routing.
- [ ] `bot/deploy-commands.ts` script.
- [ ] Manual test: run `/funding setup` in a test server → embed appears with "Monthly Coverage" and "Hours Left" fields.

**Exit criterion:** Can run `/funding setup` and see tracker embed in Discord with correct field labels.

---

### Phase 4 — Core Admin Commands
- [ ] `services/fundingService.ts`: `addDonation`, `removeDonation`, `getMonthTotal`, `getMonthRecords`.
- [ ] `/funding add` handler (with tracker refresh).
- [ ] `/funding remove` handler (with confirmation button).
- [ ] `/funding status` handler (ephemeral, role-aware detail, fires `refreshIfStale` after response — stub for now).
- [ ] Integration tests for fundingService including bounds validation.
- [ ] Manual test: add funding, verify embed updates with correct coverage display.

**Exit criterion:** Full add/remove/status cycle works. Embed reflects changes with correct labels.

---

### Phase 5 — Configuration Commands + Stale Refresh
- [ ] `/funding set-hourly-cost` handler (full MIN/MAX validation).
- [ ] `/funding config` handler (view + update).
- [ ] `/funding refresh` handler (recovery path in `trackerService`).
- [ ] `trackerService.refreshIfStale` implemented and wired to `/funding status` handler.
- [ ] `bot/events/ready.ts`: message/channel validation + missed archive recovery + stale-embed check on startup.
- [ ] Unit tests for `refreshIfStale`.
- [ ] Manual test: delete tracker message, run `/funding refresh` → message re-posted. Wait > threshold, run `/funding status` → embed refreshes.

**Exit criterion:** Configuration commands work. Recovery from deleted message works. Stale-embed refresh fires correctly from both trigger points.

---

### Phase 6 — Month Reset & Archive
- [ ] `services/archiveService.ts`.
- [ ] `scheduler/monthlyReset.ts` cron job wired up.
- [ ] `/funding reset-month` handler (with confirmation; updated response text uses "Monthly Coverage").
- [ ] `/funding history` handler (shows "Monthly Coverage" for each month).
- [ ] Missed-archive recovery in `ready.ts`.
- [ ] Integration tests for archiveService.
- [ ] Manual test: simulate month boundary, verify archive created, embed resets to 0% Monthly Coverage.

**Exit criterion:** Month archive and reset work. History command shows prior months with correct labels.

---

### Phase 7 — Polish & Hardening
- [ ] All command error handlers wrapped in try/catch with user-facing messages.
- [ ] All edge cases from Section 13 handled and tested (including hourly_cost bounds edge cases).
- [ ] Logging standardized (structured JSON in production).
- [ ] `docker-compose.dev.yml` with hot reload.
- [ ] Full test suite passes: `npm test`.
- [ ] Review all embed text, command response text, and error messages for consistency with "Monthly Coverage" / "Hours Left" terminology.

**Exit criterion:** All tests pass. No unhandled promise rejections in 24h test run. Terminology is consistent throughout.

---

### Phase 8 — Documentation & Deployment
- [ ] `README.md`: setup instructions, env var reference (`STALE_EMBED_THRESHOLD_HOURS` documented), first-time guild setup guide.
- [ ] `DEPLOY.md`: Docker deployment guide, backup procedure.
- [ ] `.env.example` finalized.
- [ ] Bot invite URL with correct permissions documented.

**Required Discord Permissions for bot invite:**
- `Send Messages`
- `Edit Messages`
- `Embed Links`
- `Read Message History`
- `Use Slash Commands`

---

## 16. Open Questions / Decisions Already Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| SQLite vs PostgreSQL | SQLite for v1 | Zero-config, Docker volume mount, adequate for single-instance bot |
| Derive vs persist hours_left | Derive dynamically | Correct after restarts, no drift, simpler code (see INV-4) |
| UTC vs guild-local timezone for month boundary | UTC | No per-guild timezone complexity; document clearly |
| Global vs guild command registration | Guild commands during development, global option for production | Guild commands are instant; global takes up to 1hr |
| Carryover on overfunding | Never | Explicit business rule; structurally impossible in this schema (see INV-5) |
| Embed as source of truth | No — DB is source of truth | Embed is lost if message deleted; state in DB survives (see INV-1, INV-2) |
| Soft delete for donation records | No (hard delete with confirmation) | Simpler; month totals are small; archive captures final state |
| node-cron vs external cron | node-cron | No external dependency; simple enough for monthly schedule; missed-archive recovery handles downtime |
| admin_role_id in config | Yes, optional | Allows non-owner admins without requiring MANAGE_GUILD |
| Confirmation flow for destructive commands | Discord button component, 30s timeout | Better UX than a confirmation keyword; standard pattern |
| Public label for coverage percentage | "Monthly Coverage" | Clearer than "Funded This Month" or "Percentage Funded" — maps to the correct mental model (runtime coverage fraction, not a payment statement) |
| Stale-embed refresh: timer vs event-driven | Event-driven only (ready + /funding status) | No rate-limit risk, no timer complexity, naturally low-frequency |
| Stale-embed threshold: per-guild vs app-wide | App-wide env var (`STALE_EMBED_THRESHOLD_HOURS`, default 6) | Operational concern, not a guild preference; keeps schema clean |
| hourly_cost bounds | MIN $0.001, MAX $1000.00 | Prevents division near-zero (astronomically large funded_hours), prevents absurd inputs; enforced at handler, service, and DB constraint layers |
| hourly_cost bounds: where enforced | All three layers: handler validation, service `validateHourlyCost()`, DB CHECK constraint | Defense-in-depth; each layer catches different failure modes |
| Internal field name vs public label for coverage % | `percentageFunded` internally, "Monthly Coverage" in embed only | Keeps service/calculation code unaffected by UX label decisions; single mapping point in `embedBuilder.ts` |

---

## Biggest Architecture Mistakes to Avoid

> The five items in Section 3 (Core Design Invariants) are the most critical. The following list covers additional operational and structural mistakes.

1. **Making the embed the source of truth.** (See INV-1, INV-2.) If you store funding state in the embed and read it back later, you will suffer when the message is deleted, the bot loses access, or Discord's API is slow. Always write to DB first, render from DB.

2. **Storing guild config in env vars.** (See INV-3.) Changing config for one guild would require restarting the bot. Config must be per-guild in the DB.

3. **Mutating a "remaining balance" field on a timer.** (See INV-4.) If the timer skips or the bot is offline, the balance will be wrong. Derive depletion from `now - month_start` every time. It is always correct.

4. **Turning stale-embed refresh into a live ticker.** The optional stale-embed refresh is event-driven and gated by a multi-hour threshold. Do not add a setInterval that edits the embed every few minutes. This will hit Discord rate limits, produce API errors, and add no meaningful value since `hours_left` is derived dynamically by anyone who reads the embed.

5. **Skipping hourly_cost bounds enforcement at any layer.** The MIN (0.001) prevents near-zero division producing millions of funded hours from a $1 donation. The MAX (1000.00) prevents hostile input. Enforce at all three layers: handler, service, DB constraint. Checking at only one layer is not sufficient — code paths change.

6. **Global state or in-memory guild state.** Caching guild config in memory without invalidation will cause stale reads after `/funding config` updates. Either skip caching in v1 or implement explicit invalidation.

7. **Handler-heavy design.** If command handlers contain calculation logic or direct DB calls, the system becomes untestable. All logic goes through services; handlers orchestrate only.

8. **Assuming the tracker message/channel still exists.** Always handle Discord API errors for unknown message/channel and recover gracefully. Never assume a stored message ID is still valid.

9. **One-size-fits-all error handling.** Discord has a 3-second interaction response deadline. Always defer immediately. Distinguish between "user error" (ephemeral message) and "system error" (log + generic user message).

---

## Future Webhook Integration Points (v1 does not implement these)

These v1 design decisions deliberately leave room for future payment integrations without requiring restructuring:

1. **`DonationRecord.donor_name` and `.note`** — already present. A webhook handler would populate these from payment provider metadata.

2. **`DonationRecord.created_by_user_id`** — in v1 this is always the Discord admin's user ID. For automated ingestion, define a sentinel value (e.g. `"webhook:kofi"`) or add a `source` field in a future migration.

3. **`FundingService.addDonation()`** — the service interface is already clean. A webhook handler (Express route or separate service) would call this same function. No command handler changes needed.

4. **`guild_tracker_config` could gain a `webhook_secret` field** — for per-guild Ko-fi/PayPal webhook verification. Add column in a future migration; v1 ignores it.

5. **The scheduler is isolated in `scheduler/monthlyReset.ts`** — adding a webhook server does not touch the scheduler.

6. **HTTP server** — v1 has no HTTP server. Add one (Fastify or Express) as a separate module alongside the bot, sharing the DB client. The bot and webhook server can run in the same process or be split into two containers sharing the DB volume.

---

## Delta From Prior Plan

This section documents every change made in Revision 2 relative to Revision 1.

### Labeling / UX Clarification

- **"Monthly Coverage" replaces "Percentage Funded" / "Funded This Month" everywhere in the public-facing embed.** The old label read as a payment statement ("funded this month"), which is confusing when a guild shows 100% late in a month with few hours left. "Monthly Coverage" maps to the correct mental model: what fraction of this month's runtime is paid for.
- The internal `FundingState.percentageFunded` field name is **unchanged** throughout calculation and service code. The label change is applied only in `embedBuilder.ts`. This is the single mapping point.
- Section 4.2 (Calculation Model) now includes a table showing the divergence scenarios between Monthly Coverage and Hours Left, with a written rationale for showing both as equal-weight fields.
- Section 10.2 (Embed Rendering) now includes a "Field Semantics" table explaining what each field answers.
- All command response text, embed layout mock, archive history display, and the reset-month confirmation message have been updated to use "Monthly Coverage."
- `month_archive.percentage_funded` column name is unchanged (it is a number in the DB). The display label differs.

### Stale-Embed Refresh Behavior

- **New env var:** `STALE_EMBED_THRESHOLD_HOURS` (default: 6). Added to `config/env.ts`, `AppConfig`, `.env.example`, and deployment documentation.
- **New method:** `trackerService.refreshIfStale(guild_id)` — checks `updated_at` against the threshold; calls `refreshTracker` only if stale. Defined in full in Section 7.7.
- **Trigger 1:** `ready.ts` — called once per enabled guild after startup validation. Added to Section 7.5 and Phase 1/5 delivery tasks.
- **Trigger 2:** `/funding status` handler — called fire-and-forget after the ephemeral response is sent. Added to Section 9.3 (`/funding status` behavior, step 4) with rationale.
- **Explicitly not a timer.** Section 7.7 states this is called from exactly two places. Section 13.7 covers failure handling for stale refresh.
- **New tests:** `trackerService.refreshIfStale.test.ts` (Section 14.6), `status.test.ts` updated to verify `refreshIfStale` is invoked.
- Architecture mistakes section updated with item 4: "Turning stale-embed refresh into a live ticker."

### hourly_cost Sanity Bounds

- **New constants:** `MIN_HOURLY_COST = 0.001` and `MAX_HOURLY_COST = 1000.00` in `src/constants/validation.ts` (new file). Rationale documented in Section 7.2.
- **DB constraint updated:** `guild_tracker_config.hourly_cost` now has `CHECK (hourly_cost >= 0.001 AND hourly_cost <= 1000.0)`. Updated in Section 8.1.
- **`donation_record.amount`** gained `CHECK (amount > 0)` in the DB schema (was only validated at the application layer previously).
- **Service-layer guard:** `fundingService` now calls `validateHourlyCost()` before any DB write for hourly_cost. Defined in Section 7.8.
- **Command handler updates:** `/funding setup` and `/funding set-hourly-cost` validation blocks now cite the MIN/MAX values with user-facing error messages. Updated in Section 9.3.
- **Calculation edge cases table** (Section 13.6) updated: the `hourly_cost = 0` row is replaced with `hourly_cost < MIN` and `hourly_cost > MAX` rows explaining that they are rejected at all layers.
- **New test file:** `constants/__tests__/validation.test.ts` (Section 14.3) covering all bounds including NaN, Infinity, and boundary values.
- Architecture mistakes section updated item 5: "Not validating hourly_cost > 0" replaced with "Skipping hourly_cost bounds enforcement at any layer" with explicit rationale for the 0.001 minimum.
- Open questions table has a new row for hourly_cost bounds and a row for where they are enforced.

### Elevated Architecture Invariants

- **New Section 3: Core Design Invariants** inserted between "Key Business Rules" and "Canonical Funding Calculation Model." All subsequent section numbers shifted by 1.
- Five named invariants (INV-1 through INV-5) are now explicitly stated, each with a one-line rule, a concrete implication, and (for INV-4) a code-level prohibition.
- Cross-references to INV-1 through INV-5 added in: Section 4.3 (calculation notes), Section 10.2 (no carryover), Section 13.3 (bot restart), and the "Biggest Architecture Mistakes to Avoid" section.
- "Biggest Architecture Mistakes to Avoid" now opens with a forward reference to Section 3 as the primary list, positioning the mistakes section as supplemental.
- Open questions table rows for "Derive vs persist hours_left," "Carryover on overfunding," and "Embed as source of truth" now cite the relevant INV number.
