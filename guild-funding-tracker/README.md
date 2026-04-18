# Guild Funding Tracker

A standalone Discord bot that tracks monthly funding contributions for a guild/community server. Members record donations; the bot maintains a live embed showing progress toward the monthly coverage goal and archives each month's state on demand.

---

## Design Model

- **Database is the single source of truth.** Guild config, donation records, and monthly archives are all in SQLite.
- **The Discord embed is a rendered artifact,** not state. It is re-rendered from the DB on demand and after each change.
- **`hours_left` is derived, never stored.** Coverage calculations are always computed live from current donations and hourly cost.
- **Month reset is emergent via `month_key`.** Each month's data lives under a unique key (e.g. `2026-04`). There is no destructive rollover.
- **Archives are snapshots.** `/funding reset-month` writes to `month_archive` without touching donation records.
- **Scheduler is passive.** A monthly self-rescheduling `setTimeout` snapshots all configured guilds automatically. It is not a polling loop.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (required for authoritative runtime and tests)
- A Discord application with a bot token — [Discord Developer Portal](https://discord.com/developers/applications)
- Bot invited to your server with `bot` + `applications.commands` scopes and the `Send Messages`, `Embed Links`, `Read Message History` permissions

---

## Quick Start

```sh
# 1. Copy and fill in credentials
copy .env.example .env        # Windows
cp .env.example .env          # macOS/Linux

# Edit .env — set DISCORD_TOKEN and DISCORD_CLIENT_ID

# 2. Register slash commands (run once, or after command changes)
npx tsx src/bot/deploy-commands.ts --guild-id=YOUR_GUILD_ID

# 3. Start the bot
npm run docker:up

# 4. View logs
npm run docker:logs
```

---

## Docker Workflow

**Docker is the authoritative runtime and test environment.**

| Task | Command |
|---|---|
| Start bot | `npm run docker:up` |
| View live logs | `npm run docker:logs` |
| Stop bot | `npm run docker:down` |
| Run full test suite | `npm run docker:test` |
| Rebuild image | `npm run docker:build` |

- The image is built directly from `docker-compose.yml` — no separate build step needed before first run.
- SQLite data persists in the `tracker_data` Docker volume across restarts and redeployments.
- Migrations run automatically at startup before Discord login.

---

## Bot Commands

All commands are subcommands of `/funding`.

| Command | Permission | Description |
|---|---|---|
| `/funding setup` | Manage Server | Configure the tracker for this server (channel, title, hourly cost) |
| `/funding add` | Any member | Record a funding contribution for the current month |
| `/funding remove` | Any member | Remove a specific donation record by ID |
| `/funding status` | Any member | View current funding status |
| `/funding set-hourly-cost` | Manage Server | Update the hourly server cost used for coverage calculations |
| `/funding config` | Manage Server | View or update tracker configuration (title, display mode) |
| `/funding refresh` | Manage Server | Force re-render and re-post the tracker embed |
| `/funding reset-month` | Manage Server | Archive a month's funding state (default: previous month) |
| `/funding history` | Any member | View archived monthly funding summaries |

> `/funding reset-month` is idempotent — running it multiple times for the same month is safe.

---

## Testing

```sh
# Authoritative — runs inside Docker where native bindings compile correctly
npm run docker:test

# Local (best-effort)
npm test
```

The test suite uses [Vitest](https://vitest.dev/). The authoritative environment is Docker. All tests must pass there. Local `npm test` may fail on Windows because `better-sqlite3` requires native bindings that are platform-specific — this is expected and not a bug.

---

## Notes

- **SQLite database** persists in the `tracker_data` Docker volume at `/data/tracker.db`.
- **No `.env.local`** — the bot reads only `.env`.
- **Startup log sequence:** environment validated → migrations applied → Discord login starting → ready (Discord) → scheduler started.
- **Graceful shutdown** on `SIGTERM` / `SIGINT` (Docker stop, Ctrl+C).
- For deployment and operator guidance, see [DEPLOY.md](DEPLOY.md).
