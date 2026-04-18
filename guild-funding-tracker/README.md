# Guild Funding Tracker

A standalone Discord bot for tracking guild monthly funding.

---

## Development Workflow

**Docker is the authoritative runtime and test environment.**

`better-sqlite3` requires native compilation. Docker guarantees this compiles correctly regardless of the host OS. Local `npm test` is best-effort only — native bindings may not work on the host (e.g., Windows).

### Setup

```sh
copy .env.example .env   # Windows
cp .env.example .env     # macOS/Linux
# Fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
```

### Start the bot

```sh
npm run docker:up
```

### View logs

```sh
npm run docker:logs
```

### Run tests (authoritative)

```sh
npm run docker:test
```

Runs the full test suite inside Docker where `better-sqlite3` is correctly compiled. All tests must pass here.

### Stop

```sh
npm run docker:down
```

### Rebuild after dependency changes

```sh
npm run docker:build
npm run docker:up
```

---

## Notes

- SQLite database persists in the `tracker_data` Docker volume across restarts.
- Database migrations run automatically at bot startup before login.
- The bot reads configuration from `.env` only — no `.env.local`.
- Local `npm test` may fail on Windows due to native module binding mismatch. This is expected and not a bug.
