# Lunar\Hangout Implementation Plan

> **For Hermes:** Use `subagent-driven-development` if implementation is delegated later.

**Goal:** Ship Lunar\Hangout as a staged upgrade of the existing live presenter mode, starting with Demo Day Live and preserving the current Google Meet companion model.

**Architecture:** LunarPad already has the beginnings of a live-event system: `public/live.html`, `/live/:eventId`, and `/api/live/:eventId*` endpoints in `server.js`. The right move is not to reinvent that from scratch. Instead, extend the existing live session, speaker, vote, and zap primitives into a clearer event-state model, then layer host controls, audience UX, payout flow, and recap generation on top in small vertical slices.

**Tech Stack:** Node.js, Express, SQLite (`node:sqlite`), server-rendered/static HTML pages in `public/`, shared CSS in `public/css/style.css`, inline page JS, existing vote/zap/payment flows in `server.js`.

---

## What the codebase already gives us

### Existing live foundation
- `server.js:844`
  - `/live/:eventId` already serves `public/live.html`
- `server.js:3049-3094`
  - existing live APIs:
    - `GET /api/live/:eventId`
    - `POST /api/live/:eventId/start`
    - `POST /api/live/:eventId/stop`
    - `POST /api/live/:eventId/speaker`
- `public/live.html:382-654`
  - existing fullscreen live view
  - audience vote button
  - admin start/stop controls
  - speaker lineup sidebar
  - deck iframe stage

### Existing event/speaker primitives
- `server.js:1160-1180`
  - `/api/events` already returns speakers + RSVP preview data
- `server.js:1982-2055`
  - event detail payload and event speaker listing
- `server.js:2016-2031`
  - speaker sign-up already exists
- `server.js:2033-2043`
  - presenters can already be marked as presented
- `server.js:142-147`
  - `speakers` already have `scheduled_at`, `status`, and `presented_at`

### Existing voting/zap/payment primitives
- `public/event.html:566-568`
  - speakers already use `type:'speaker'` voting
- `public/project.html:316-318`
  - standard vote POST pattern already exists
- `public/project.html:558-559`
  - project zap flow already exists
- `CLAUDE.md:262-269`
  - current data model already includes `votes`, `zaps`, `rsvps`, `speakers`

### Key implication
We are **not** starting from zero. Demo Day Live v1 should be implemented as a structured upgrade of the existing live presenter mode, not a net-new subsystem.

---

## Product intent to preserve

1. **Google Meet is the room; LunarPad is the stage.**
2. **Votes determine the v1 winner.**
3. **Zaps are visible support, not pay-to-win winner logic.**
4. **Payout remains host-confirmed in v1.**
5. **Every event should leave behind a recap/result artifact.**

---

## Recommended delivery shape

Ship this in **6 passes** so each pass is usable and testable.

1. **Pass 0 — Stabilize the data model and API contract**
2. **Pass 1 — Upgrade Live Mode into Demo Day Live host control**
3. **Pass 2 — Make the audience stage legible and worth following**
4. **Pass 3 — Add live zaps + scoreboard**
5. **Pass 4 — Add host-confirmed winner + payout flow**
6. **Pass 5 — Generate post-event recap/results artifact**
7. **Pass 6 — Expand into reusable Hangout formats later**

Passes 0-5 are the actual scoped implementation plan for issue `#53`.

---

## Pass 0 — Stabilize the data model and API contract

**Objective:** Add the missing persistence and event-state fields so later UI work does not become inline spaghetti.

**Why first:** The current live session tracks only `is_active` and `current_speaker_id`. Demo Day Live needs real state: voting open/closed, timer intent, winner, payout status, Meet link, and queue semantics.

### Task 0.1: Inspect current schema and migrations before editing

**Files:**
- Inspect: `server.js:1-380`
- Inspect: existing migration list near `v019_speaker_presented_state`

**Implementation notes:**
- Confirm how `live_sessions` is created today.
- Confirm whether event metadata belongs on `events` vs `live_sessions`.
- Prefer additive migrations over table rewrites.

**Acceptance criteria:**
- We know exactly which new columns/tables are needed before writing code.

### Task 0.2: Extend `live_sessions` for Demo Day state

**Files:**
- Modify: `server.js` schema + migrations

**Add fields like:**
- `mode` (`demo-day-live` for now)
- `status` (`idle`, `live`, `voting`, `winner_pending`, `completed`)
- `voting_open` integer/bool
- `current_started_at`
- `current_duration_minutes`
- `winner_speaker_id`
- `winner_confirmed_at`
- `payout_status` (`pending`, `confirmed`, `sent`)
- `meet_url`
- `ended_at`

**Acceptance criteria:**
- Live session rows can represent the whole event lifecycle without fragile computed-only logic.

### Task 0.3: Add a durable event recap/results table

**Files:**
- Modify: `server.js` schema + migrations

**Suggested table:** `event_results`
- `id`
- `event_id`
- `winner_speaker_id`
- `winner_name`
- `winner_project_title`
- `total_votes`
- `total_zaps`
- `results_json`
- `summary_markdown` or `summary_html`
- `created_at`

**Acceptance criteria:**
- Results can persist independently of the live session being active.

### Task 0.4: Normalize speaker ordering and status semantics

**Files:**
- Modify: `server.js` schema + speaker queries

**Add fields if missing:**
- `queue_position`
- optional `skipped_at`

**Status vocabulary for v1:**
- `scheduled`
- `up_next`
- `live`
- `presented`
- `skipped`
- `winner`

**Acceptance criteria:**
- Queue order no longer depends on `created_at` hacks.
- One clear status vocabulary exists across API + UI + badges.

### Task 0.5: Introduce a single live-state serializer helper

**Files:**
- Modify: `server.js:3049-3094` area

**Implementation notes:**
- Extract a helper like `getLiveSessionPayload(eventId, viewer)`.
- Reuse it in `GET /api/live/:eventId` and future host endpoints.
- Payload should include:
  - event
  - session
  - current speaker
  - next speaker
  - speakers ordered by queue
  - voting state
  - score summary
  - payout state
  - meet/join URLs

**Acceptance criteria:**
- Later UI pages consume one coherent contract instead of assembling state ad hoc.

**Verification for Pass 0:**
- `npm test`
- `node --check server.js`
- manual API smoke via browser or `curl` for `GET /api/live/:eventId`

---

## Pass 1 — Upgrade Live Mode into Demo Day Live host control

**Objective:** Make the existing live presenter mode usable for real hosts running a demo day.

**Why now:** Current live mode can start/stop a session and set a speaker, but that is too thin for real event operations.

### Task 1.1: Add host-only control endpoints for session state

**Files:**
- Modify: `server.js:3070-3094` area

**New endpoints:**
- `POST /api/live/:eventId/open-voting`
- `POST /api/live/:eventId/close-voting`
- `POST /api/live/:eventId/advance`
- `POST /api/live/:eventId/reset-speaker`
- `POST /api/live/:eventId/complete`

**Acceptance criteria:**
- Host can run the session without DB fiddling or abusing the existing speaker setter.

### Task 1.2: Add host-only speaker lifecycle actions

**Files:**
- Modify: `server.js` near speaker endpoints

**New endpoints:**
- `POST /api/speakers/:id/live`
- `POST /api/speakers/:id/up-next`
- `POST /api/speakers/:id/skip`
- reuse or wrap `POST /api/speakers/:id/presented`

**Acceptance criteria:**
- Speaker state is explicit and can be driven from host UX.

### Task 1.3: Turn `public/live.html` admin bar into a real host toolbar

**Files:**
- Modify: `public/live.html`
- Modify: `public/css/style.css` only if shared button/status styles are worth extracting

**Add controls:**
- start / end session
- mark live
- advance to next presenter
- open / close voting
- mark presented
- skip presenter

**Acceptance criteria:**
- An admin can operate a whole demo day from the live page without hidden assumptions.

### Task 1.4: Add visible event-state labels in the live UI

**Files:**
- Modify: `public/live.html`

**Required labels:**
- `Live now`
- `Up next`
- `Voting open`
- `Voting closed`
- `Winner pending`
- `Event complete`

**Acceptance criteria:**
- Audience and presenters can tell what state the event is in without asking the host.

### Task 1.5: Surface Meet link cleanly, but keep it separate from the stage

**Files:**
- Modify: `public/live.html`
- Modify: `public/event.html`
- Modify: `server.js` event/live payloads if needed

**Implementation notes:**
- Reuse `events.virtual_link` or add `session.meet_url` override.
- Show a clear `Join Meet` action for host/audience.
- Do not try to embed Meet.

**Acceptance criteria:**
- The event page and live page clearly route people to the call while keeping LunarPad as the control/stage layer.

**Verification for Pass 1:**
- `npm test`
- `node --check server.js`
- browser QA on `/live/:eventId` as admin and non-admin

---

## Pass 2 — Make the audience stage legible and worth following

**Objective:** Make the audience-facing stage actually feel like a live product surface instead of a deck iframe with a vote button.

### Task 2.1: Rework the lineup into upcoming / live / completed groups

**Files:**
- Modify: `public/live.html`

**Acceptance criteria:**
- One current speaker is strongly highlighted.
- Up next is visible.
- Presented speakers are visually separated from upcoming ones.

### Task 2.2: Add a proper stage summary panel

**Files:**
- Modify: `public/live.html`

**Panel should show:**
- presenter name
- project title
- short description
- deck presence/fallback
- event state label
- vote status
- zap totals once added in Pass 3

**Acceptance criteria:**
- Audience can understand who is on stage even if there is no deck loaded.

### Task 2.3: Add timer UI tied to session state

**Files:**
- Modify: `public/live.html`
- Modify: `server.js` live payload helper

**Implementation notes:**
- Start simple: countdown from `current_started_at + current_duration_minutes`.
- Timer is informational first; host can still run manually.

**Acceptance criteria:**
- `2 min left` / `Time up` style state is visible and reliable enough for the host.

### Task 2.4: Make voting availability explicit

**Files:**
- Modify: `public/live.html`
- Modify: `server.js` vote guard logic if needed

**Implementation notes:**
- Disable or hide live voting CTA when `voting_open` is false.
- Return a clean server error if a user attempts to vote while voting is closed.

**Acceptance criteria:**
- Audience only votes during the intended event window.

### Task 2.5: Decide and document vote constraint behavior

**Files:**
- Modify: `server.js` vote endpoint if needed
- Modify: tests in `tests/`
- Update: `docs/specs/2026-04-07-lunar-hangout-product-spec.md` only if implementation sharpens the rule

**Recommended v1 rule:**
- one vote per speaker per user/device/IP, matching the current lightweight voting model

**Acceptance criteria:**
- Winner mechanics are legible enough to explain publicly.

**Verification for Pass 2:**
- `npm test`
- browser QA for audience flow on desktop + mobile width

---

## Pass 3 — Add live zaps + scoreboard

**Objective:** Make Demo Day Live feel Bitcoin-native without letting zaps decide the winner.

### Task 3.1: Add speaker-level zap aggregation to the live payload

**Files:**
- Modify: `server.js` live payload helper

**Implementation notes:**
- Reuse existing `zaps` table patterns.
- If speaker zaps do not fit current target model well, tie zaps to linked `project_id` or `deck_id` in v1 and expose them through the speaker payload.

**Acceptance criteria:**
- Each live speaker payload includes total sats and recent zaps.

### Task 3.2: Add audience zap CTA on the live stage

**Files:**
- Modify: `public/live.html`
- Reference: existing zap modal behavior in `public/project.html` and `public/deck.html`

**Acceptance criteria:**
- Audience can zap the live presenter using a familiar flow.

### Task 3.3: Add a compact live scoreboard

**Files:**
- Modify: `public/live.html`

**Display:**
- votes
- sats zapped
- maybe recent supporters

**Acceptance criteria:**
- The stage feels active and high-signal without turning into noise.

### Task 3.4: Add host-facing scoreboard view

**Files:**
- Modify: `public/live.html` or `public/event.html`
- Modify: `server.js` payload if a separate host summary is cleaner

**Acceptance criteria:**
- Host can quickly see who is leading without manually scanning the lineup.

**Verification for Pass 3:**
- `npm test`
- manual zap smoke flow using staging lightning config
- confirm zaps display but do not alter winner selection logic

---

## Pass 4 — Add host-confirmed winner + payout flow

**Objective:** Make the end of the event trustworthy and operationally sane.

### Task 4.1: Add system winner recommendation endpoint/helper

**Files:**
- Modify: `server.js`

**Implementation notes:**
- Winner recommendation should be computed from votes only.
- Tie-breakers should be deterministic and documented.
- Good v1 tie-breaker: highest votes, then highest zaps, then earliest queue position.

**Acceptance criteria:**
- Host sees one clear recommended winner instead of ambiguous totals.

### Task 4.2: Add host confirmation endpoint and state mutation

**Files:**
- Modify: `server.js`

**New endpoint:**
- `POST /api/live/:eventId/confirm-winner`

**Effects:**
- stores `winner_speaker_id`
- marks speaker status `winner`
- flips session status to `winner_pending` or equivalent

**Acceptance criteria:**
- Winner state is durable and visible publicly.

### Task 4.3: Add payout confirmation UX

**Files:**
- Modify: `public/live.html`
- Modify: `public/event.html` if results are also shown there
- Modify: `server.js`

**Implementation notes:**
- Start with host-confirmed/manual payout only.
- First slice may simply record `payout_status='confirmed'` and show payout instructions.
- If there is an existing internal payout action worth reusing, link to it rather than creating a fake automatic flow.

**Acceptance criteria:**
- The UI never implies sats were sent automatically unless they actually were.

### Task 4.4: Add public winner/payout status display

**Files:**
- Modify: `public/live.html`
- Modify: `public/event.html`

**Acceptance criteria:**
- Audience can see winner confirmed / payout pending / payout complete states.

**Verification for Pass 4:**
- `npm test`
- host QA confirms winner and payout states survive page reloads

---

## Pass 5 — Generate post-event recap / results artifact

**Objective:** Ensure the event leaves behind content and proof, not just a finished live page.

### Task 5.1: Add recap generation on session completion

**Files:**
- Modify: `server.js`

**Implementation notes:**
- On `complete` or winner confirmation, gather:
  - ordered speakers
  - votes per speaker
  - total zaps
  - winner
  - event metadata
- Store it in `event_results`

**Acceptance criteria:**
- Completed live sessions produce a durable stored result payload.

### Task 5.2: Add results section to the event detail page

**Files:**
- Modify: `public/event.html`
- Modify: `server.js:1982-1992` event payload or add `GET /api/events/:id/results`

**Acceptance criteria:**
- Past events show meaningful results instead of dead-end recap affordances.

### Task 5.3: Add a dedicated result/recap presentation block

**Files:**
- Modify: `public/event.html`
- Optional create: `public/event-results.html` if a dedicated page becomes cleaner

**Display:**
- winner
- rankings
- total votes
- total sats zapped
- presenters with project/deck links

**Acceptance criteria:**
- A person who missed the live event can still understand what happened.

### Task 5.4: Wire Build page recap links to real result availability

**Files:**
- Modify: `public/build.html`
- Modify: `server.js` event payloads

**Acceptance criteria:**
- Past events only show recap/result CTAs when actual result content exists.

**Verification for Pass 5:**
- `npm test`
- browser QA on `/event/:id` and Build past-events section

---

## Pass 6 — Expand into reusable Hangout formats later

**Objective:** Keep the architecture reusable once Demo Day Live is real.

**Not part of immediate implementation.**

Later expansion should cover:
- office hours / hangout mode
- hot-seat queue
- bounty review mode
- reusable room templates
- recurring room setup

The key is that Passes 0-5 should leave behind flexible session state and recap primitives that support this without a rewrite.

---

## Recommended issue breakdown after this plan

Create sub-issues under `#53`:
1. **Live session state/model cleanup**
2. **Demo Day host control toolbar**
3. **Audience stage and voting state UX**
4. **Live zaps + scoreboard**
5. **Winner + payout confirmation flow**
6. **Post-event recap/results artifact**

That is the cleanest way to execute this without one giant muddy branch.

---

## Testing strategy

### Minimum verification each pass
Run:
```bash
npm test
node --check server.js
```

### Add/update tests in `tests/` for:
- live session state transitions
- speaker status transitions
- voting-open vs voting-closed behavior
- winner selection logic
- payout-state serialization
- recap generation payload shape

### Manual QA checklist
- host can start/end session
- host can move queue forward cleanly
- audience sees current + next presenter clearly
- vote CTA only works when intended
- zap CTA works with the same reliability as existing project/deck zap flows
- winner confirmation survives reloads
- completed events show durable results

---

## Recommended execution order right now

If we start building immediately, do it in this order:

1. **Pass 0 first** — no skipping it
2. **Pass 1 next** — make host control real
3. **Pass 2 next** — make the stage legible
4. **Pass 3/4 after that** — zaps, winner, payout
5. **Pass 5 last** — recap/results once the live flow is trustworthy

My recommendation:
- **Start with sub-issue 1: live session state/model cleanup**
- then immediately implement **sub-issue 2: Demo Day host control toolbar**

That gets us from “cool prototype” to “real operator surface” fastest.
