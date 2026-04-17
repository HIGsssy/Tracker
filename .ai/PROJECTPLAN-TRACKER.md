# Guild Funding Tracker — Project Scope

## 1. Project Overview

Build a standalone, Dockerized Discord bot/service that provides a **guild-specific monthly funding tracker** for hosting costs. The feature must allow each Discord server (guild) to maintain its own independent tracker, including its own monthly goal, donation total, hosting cost assumptions, display message, and configuration.

The system will present funding progress inside Discord using one or more **persistent, dynamically updated embeds**. These embeds must be editable by the bot and tied to a specific channel/message per guild.

The primary purpose is to show community members:

* the monthly hosting goal
* how much has been raised so far
* how much remains
* how many hosting hours are covered
* how many hours remain to be funded

This should function as a lightweight, reliable standalone operational bot/service rather than a full payment platform.

---

## 2. Goals

### Primary Goals

* Provide a **per-guild funding status tracker** inside Discord.
* Allow staff/admins to update donation totals through bot commands.
* Automatically recalculate and refresh the guild’s funding embed when values change.
* Support **different configurations per guild**, including custom monthly goal and hourly backend cost.
* Run cleanly in **Docker** for local development and deployment.

### Secondary Goals

* Make the display clear and visually useful to regular users.
* Minimize Discord channel noise by editing a persistent message instead of posting repeated updates.
* Allow future expansion into payment/webhook integrations without rewriting the core tracker logic.

---

## 3. Non-Goals

The first version should **not** include:

* direct payment processing
* Ko-fi, Patreon, Stripe, PayPal, or webhook integrations
* accounting/reporting beyond tracker totals and simple donation records
* multi-tenant web dashboard
* public API for third-party systems
* automated tax/receipt handling

Those can be designed later, but v1 should focus on reliable manual or admin-driven updates.

---

## 4. Core Functional Requirements

### 4.1 Guild-Specific Tracking

Each guild must have its own independent tracker state.

Per guild, the system must store:

* guild ID
* enabled/disabled state
* monthly funding goal
* hourly backend cost (default should be configurable)
* current month donation total
* optional donation records for the current month
* tracker channel ID
* tracker message ID
* preferred currency display string
* optional display title/branding text
* reset behavior / month rollover state

The tracker for one guild must never affect another guild.

### 4.2 Persistent Discord Display

The system must support a persistent embed message per guild.

The bot must be able to:

* create the initial tracker message in a configured channel
* store the resulting message ID
* edit the same message on future updates
* recreate the tracker message if it has been deleted or becomes invalid

### 4.3 Funding Calculations

The system must calculate funding coverage based on the stored funded amount and the configured hourly backend cost.

The public-facing tracker should **not** display a dollar goal. Instead, it must display:

* percentage funded for the current month
* hours left for the current month
* optional hours already covered
* optional status label

The backend must still store funding contributions as dollar amounts, but those values are used only for calculations and admin management.

Core calculation model:

* each guild stores contributed funding as dollar amounts
* hourly backend cost is configurable per guild
* funding is converted into runtime coverage using the hourly cost
* runtime coverage is consumed over time at the configured hourly rate
* the public tracker reflects how much of the current month is funded and how many runtime hours remain

Required calculations:

* `month_hours = days_in_current_month * 24`
* `funded_hours = total_funded_amount / hourly_cost`
* `hours_elapsed_in_month = elapsed time since month start, expressed in hours`
* `hours_left = max(0, funded_hours - hours_elapsed_in_month)`
* `percentage_funded_for_month = min(100, (funded_hours / month_hours) * 100)`

Alternative interpretation supported by the design:

* instead of decrementing against elapsed month time, the tracker may compute remaining covered runtime from the current funded balance and reduce that value by `0.06/hour` on a rolling basis
* implementation must choose one canonical approach and apply it consistently

For this project, the preferred implementation is:

* store funding additions as dollar amounts
* convert those amounts into funded runtime hours
* reduce remaining covered hours continuously based on the configured hourly cost as the month progresses
* compute the displayed monthly percentage as the proportion of total monthly runtime that is currently funded

The system should support internal administrative visibility into:

* total funded amount
* total funded hours
* hours consumed so far this month
* hours remaining

Public-facing display should prioritize:

* percentage funded for the month
* hours left
* last updated timestamp

### 4.4 Administrative Commands

The bot must provide admin/staff-only slash commands for managing the tracker.

Minimum command set:

* `/funding setup` — configure tracker channel and create the embed
* `/funding status` — display current funding state
* `/funding add` — add a donation amount
* `/funding remove` — subtract or correct a donation amount
* `/funding set-goal` — define the monthly goal for the guild
* `/funding set-hourly-cost` — define hourly cost for runtime conversion
* `/funding refresh` — force embed regeneration
* `/funding reset-month` — reset monthly tracker totals
* `/funding config` — inspect current guild settings

Optional but recommended:

* `/funding set-title`
* `/funding set-currency`
* `/funding set-style`
* `/funding list-donations`

### 4.5 Donation Record Handling

The system should support at least basic donation event recording.

Each donation record should allow:

* amount
* timestamp
* optional donor display name
* optional note/source
* guild ID
* month key

This allows:

* recomputing totals from source records
* auditability
* undo/correction support
* future integrations with external funding sources

### 4.6 Month Rollover

The tracker must support a monthly reset workflow.

For this project, month rollover behavior is explicitly defined as:

* funding balance resets to zero at the start of each new month
* unused funded hours do not carry over into the next month
* the next month’s funding is added manually by an admin
* prior-month donation records and summaries should remain available for history/audit purposes

Preferred implementation for v1:

* provide a manual reset command such as `/funding reset-month`
* optionally support an automatic calendar-month reset that archives the prior month and initializes the new month at zero
* regardless of whether reset is manual or automatic, the new month must begin with zero funded balance

This is a hard business rule for the scope:

* **no carryover of unused balance between months**

---

## 5. Display Requirements

### 5.1 Embed Content

The embed should clearly present the funding state in a user-friendly way.

The public-facing embed should emphasize operational coverage rather than raw financial targets.

Recommended public fields:

* Percentage Funded This Month
* Hours Left
* Optional Hours Covered
* Funding Status
* Last Updated

Recommended internal/admin-visible fields or command output:

* funded dollar amount
* hourly backend cost
* funding records for the month

Recommended visual elements:

* text progress bar based on percentage funded
* status label such as `Funded`, `Partially Funded`, `Low Coverage`, `Needs Support`
* optional concise explanatory text such as `Current support covers approximately 312 hours of runtime this month`

The public embed should not display a raw dollar goal unless explicitly enabled later as an optional feature.

### 5.2 Display Strategy

Preferred strategy:

* one persistent public embed per guild
* edited in place whenever funding state changes

Optional strategy:

* one public status embed
* one private/admin control or audit embed

### 5.3 Rate Limit Awareness

The system must avoid unnecessary Discord API updates.

It should:

* update the embed only when state changes
* debounce burst updates where practical
* avoid timer-driven frequent edits unless required

This is a status board, not a heart monitor.

---

## 6. Configuration Requirements

### 6.1 Application-Level Configuration

Application-wide config must be provided through environment variables for Docker deployment.

Examples:

* Discord bot token
* default hourly cost
* default currency
* logging level
* database connection string
* timezone behavior
* automatic rollover enabled/disabled

### 6.2 Guild-Level Configuration

Guild-specific settings must **not** live only in environment variables.

Because each server needs independent settings, guild-specific configuration must be persisted in a database.

Per-guild configuration should include:

* guild ID
* tracker enabled
* tracker channel ID
* tracker message ID
* hourly cost
* display title
* currency symbol/code for admin-facing funding input
* last updated timestamp
* rollover mode
* public display mode

Optional per-guild configuration may include:

* whether dollar values are hidden from the public embed
* whether hours covered should be shown alongside hours left
* custom status thresholds for funded / low coverage states

For this project, rollover mode should default to and support:

* monthly reset to zero
* no carryover into the next month
* manual funding entry for each new month

This is a critical boundary:

* **env vars = app defaults and secrets**
* **database = guild-specific state and settings**

---

## 7. Data Storage Requirements

A small relational database should be used.

Preferred choices:

* SQLite for minimal local development
* PostgreSQL for production or long-term durability

If the rest of the bot stack already uses PostgreSQL, use PostgreSQL directly to avoid pointless split-brain engineering.

### Minimum tables/entities

#### GuildTrackerConfig

* id
* guild_id (unique)
* enabled
* tracker_channel_id
* tracker_message_id
* hourly_cost
* currency_code or currency_symbol
* display_title
* public_display_mode
* hide_public_dollar_values
* rollover_mode
* created_at
* updated_at

#### DonationRecord

* id
* guild_id
* month_key
* amount
* donor_name (nullable)
* note (nullable)
* created_by_user_id
* created_at

#### FundingMonthSummary (optional)

* id
* guild_id
* month_key
* total_amount
* goal_amount
* hourly_cost
* archived_at

---

## 8. Docker Requirements

The project must run in Docker for development and deployment.

### Required deliverables

* `Dockerfile`
* `.env.example`
* `docker-compose.yml` for local development

### Local development stack

Recommended baseline:

* bot application container
* database container (if PostgreSQL is used)

### Expectations

* bot should boot from container startup
* configuration should come from env vars
* database migrations/init should be repeatable
* persistent data volume should be supported
* logs should go to stdout/stderr for container visibility

The goal is boring reliability, not handcrafted snowflake deployment.

---

## 9. Permissions and Security

The bot must enforce guild-level admin/staff restrictions on funding management commands.

At minimum:

* only users with `Manage Guild` or configured admin roles may run funding modification commands
* read-only status display can remain public

The bot must also:

* validate amounts before writing records
* reject negative or malformed values where inappropriate
* sanitize donor names/notes before display
* avoid exposing secrets in logs

---

## 10. Suggested Architecture

### 10.1 Recommended Application Modules

#### Discord Layer

Handles:

* slash commands
* permission checks
* embed rendering
* posting/editing messages

#### Funding Service Layer

Handles:

* funding calculations
* monthly rollover logic
* tracker state retrieval
* donation add/remove logic
* summary generation

#### Persistence Layer

Handles:

* guild configuration storage
* donation record storage
* month summaries/history

#### Scheduler / Background Task Layer

Optional for v1, but useful for:

* automatic month rollover
* stale message validation
* periodic reconciliation

### 10.2 Architectural Principle

The embed generation must be derived from stored state, not manually assembled in command handlers with duplicated logic.

In other words:

* commands change state
* service recalculates summary
* renderer builds embed
* Discord adapter updates message

That separation will save you from spaghetti later.

---

## 11. Suggested Technical Approach

This project should be implemented as a **standalone Discord bot/service**, not as a feature inside another existing bot.

That means the application should have:

* its own Discord client setup
* its own command registration flow
* its own persistence layer
* its own configuration and deployment model
* its own Docker runtime

The internal structure should still remain modular, with clear separation between:

* Discord transport layer
* funding business logic
* persistence layer
* embed rendering layer
* optional scheduling/reset layer

The bot may coexist with other bots in a guild, but it must not depend on them in any way.

Recommended implementation qualities:

* standalone application architecture
* command-driven interaction model
* service-oriented internal design
* typed config models
* embed renderer isolated from business logic
* persistent storage abstracted behind repository/service functions

---

## 12. Operational Requirements

The standalone bot/service should support:

* restart safety
* message ID persistence
* recalculating embeds after restart
* graceful handling if a configured channel or message no longer exists
* straightforward backup of state via database backup

The system must not require manual repair after every deploy like a Victorian steam engine.

---

## 13. Testing Requirements

Minimum test coverage should include:

### Unit Tests

* funding math
* progress percentage math
* hours covered/remaining math
* month goal calculations
* rollover behavior
* embed payload generation

### Integration Tests

* guild config creation/update
* donation add/remove persistence
* embed update flow
* missing/deleted message recovery
* multi-guild isolation

### Manual Validation

* setup in two separate guilds
* confirm independent tracker behavior
* confirm updates only affect the correct guild
* confirm reset/month rollover behavior

---

## 14. Future Expansion Considerations

The design should leave room for later additions such as:

* Ko-fi webhook ingestion
* Patreon webhook ingestion
* Stripe or PayPal support
* web dashboard for guild owners
* role-based donor perks
* support tiers
* public funding history
* analytics and trend reporting

This means donation records and guild config should be modeled cleanly now, even if v1 is manual.

---

## 15. Acceptance Criteria

The project is successful when:

* the bot runs in Docker
* a guild admin can set up a tracker in a chosen channel
* the bot creates a persistent funding embed for that guild
* an admin can add or remove funding amounts through commands
* the bot updates the embed correctly after each change
* the public embed shows percentage funded for the month, hours left, and last updated time
* the tracker’s public display does not require showing a raw dollar goal
* each guild’s tracker is fully independent
* tracker state survives container restarts
* month reset sets the funded balance to zero
* unused funded balance does not carry over into the next month

---

## 16. Recommended v1 Delivery Slice

### Phase 1 — Core Tracker

* standalone bot project scaffold
* Discord client and slash command registration
* data model for guild config and donation records
* `/funding setup`
* `/funding add`
* `/funding remove`
* `/funding status`
* persistent embed creation/editing
* public embed showing percentage funded and hours left
* Docker setup

### Phase 2 — Configuration and Polish

* `/funding set-hourly-cost`
* `/funding config`
* improved embed formatting
* optional hours-covered display
* missing-message recovery
* configurable public/private display options

### Phase 3 — Rollover and History

* monthly reset logic
* historical month storage
* reset/archive workflow
* optional scheduled reset support
* enforce no-carryover rule between months

### Phase 4 — External Integration Readiness

* normalized donation source model
* webhook-ready ingestion boundary
* future Ko-fi/Patreon adapter design

---

## 17. Final Implementation Guidance

This should be treated as a **standalone, guild-scoped funding status bot/service**, not a hardcoded single-server widget or a feature embedded inside another bot.

The two most important design decisions are:

1. **persist guild configuration in a database**
2. **treat the Discord embed as a rendered view of stored state**

If those two things are done properly, the rest is mostly plumbing. If they are done badly, the project becomes an archaeological dig six weeks later.
