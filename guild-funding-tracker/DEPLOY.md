# Deployment Guide

Operator reference for running Guild Funding Tracker in production.

---

## Prerequisites

- Docker and Docker Compose installed on the host
- A Discord bot token and application (client) ID from the [Discord Developer Portal](https://discord.com/developers/applications)
- The bot invited to your server with `bot` + `applications.commands` scopes and the permissions: `Send Messages`, `Embed Links`, `Read Message History`

---

## Initial Setup

### 1. Clone the repository

```sh
git clone <repo-url>
cd guild-funding-tracker
```

### 2. Configure environment

```sh
copy .env.example .env   # Windows
cp .env.example .env     # macOS/Linux
```

Edit `.env` and set at minimum:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
```

All other values have working defaults. See `.env.example` for descriptions.

### 3. Register slash commands

Run once (or again after any command changes):

```sh
# Instant registration for a specific guild (recommended for testing):
npx tsx src/bot/deploy-commands.ts --guild-id=YOUR_GUILD_ID

# Global registration (up to 1 hour for Discord to propagate):
npx tsx src/bot/deploy-commands.ts --global
```

Requires `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in `.env`.

---

## Running the Bot

```sh
# Start in background
npm run docker:up

# View live logs
npm run docker:logs

# Stop
npm run docker:down
```

The bot starts, applies any pending database migrations, connects to Discord, and starts the monthly archive scheduler — all in that order.

---

## Persistent Data

SQLite database is stored in the `tracker_data` Docker named volume, mounted at `/data/tracker.db` inside the container.

The volume persists across `docker:down` / `docker:up` cycles. It is **not** removed by `docker compose down` unless you explicitly pass `-v`.

---

## Backups

To back up the database:

```sh
# Copy the DB file out of the volume to the host
docker run --rm -v tracker_data:/data -v "$(pwd)":/backup alpine \
  cp /data/tracker.db /backup/tracker-backup-$(date +%Y%m%d).db
```

On Windows (PowerShell):

```powershell
$date = Get-Date -Format "yyyyMMdd"
docker run --rm -v guild-funding-tracker_tracker_data:/data -v "${PWD}:/backup" alpine `
  cp /data/tracker.db /backup/tracker-backup-$date.db
```

> Note: the volume name is prefixed with the compose project name (directory name by default, e.g. `guild-funding-tracker_tracker_data`).

---

## Updating / Redeploying

```sh
# Pull latest code
git pull

# Rebuild the image and restart
npm run docker:build
npm run docker:up
```

Migrations run automatically on startup — no manual migration step is needed after an update.

---

## Logs

```sh
# Follow live logs
npm run docker:logs

# View recent logs (last 100 lines)
docker compose logs --tail=100 bot
```

Log retention is capped at 10 MB per file, 3 files (configured in `docker-compose.yml`).

### Startup log sequence

A healthy startup looks like:

```
[startup] Environment validated. NODE_ENV=production LOG_LEVEL=info
[startup] Database migrations applied.
[startup] Discord login starting.
[ready]   Connected as BotName#0000. Serving N guild(s): ...
[ready]   Validating N enabled tracker config(s).
[startup] Monthly reset scheduler started.
```

---

## Restart Policy

The `bot` service uses `restart: unless-stopped`. The container will restart automatically after host reboots or crashes, unless you manually run `docker compose down`.

---

## Resetting a Guild's Data

There is no built-in admin reset command. If you need to clear a guild's config or donations for testing:

1. Stop the bot: `npm run docker:down`
2. Connect directly to the DB (e.g. with [DB Browser for SQLite](https://sqlitebrowser.org/) against the volume)
3. Delete the relevant rows from `guild_config` and/or `donation_record`
4. Restart: `npm run docker:up`

Do not delete `month_archive` rows — they are historical snapshots.

---

## Running Tests

```sh
npm run docker:test
```

Runs the full Vitest suite inside Docker where `better-sqlite3` native bindings compile correctly. All tests must pass here before any deployment.
