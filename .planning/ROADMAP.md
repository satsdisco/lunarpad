# Roadmap: LunarPad — The Foyer

## Milestone: v1.0 — The Foyer

### Phase 1: Database and API Foundation
**Goal:** Create the ideas table, migration, and all CRUD API endpoints so the data layer is complete and testable before any UI exists.
**Requirements:** IDEA-01, IDEA-02, IDEA-05
**Success criteria:**
1. POST /ideas creates a row with UUID, title, description, author_id, sats_pool, and timestamps
2. GET /ideas returns a list with sort/filter params (top_voted, most_zapped, newest, biggest_teams) returning correct ordering
3. GET /ideas/:idea_id returns a single idea with vote count, zap total, and team size
4. Migration runs cleanly on a fresh database and on the existing production schema

### Phase 2: The Foyer Page and Navigation Tab
**Goal:** Render the ideas list as a browsable page at /foyer with a nav tab so builders can discover and post ideas through the UI.
**Requirements:** NAV-01, IDEA-01, IDEA-02, IDEA-05
**Success criteria:**
1. "The Foyer" tab appears in the top nav bar and is active when on /foyer
2. Ideas list renders with title, description, author, vote count, zap total, and team size
3. Sort/filter controls change the displayed order without a page reload
4. Post Idea form submits and the new idea appears at the top of the list without refresh

### Phase 3: Upvoting and Zapping Ideas
**Goal:** Wire the existing vote and zap infrastructure to ideas so builders can signal interest and pool sats behind an idea.
**Requirements:** IDEA-03, IDEA-04
**Success criteria:**
1. Upvote button on an idea increments the vote count and persists across page reload
2. A user cannot vote on the same idea twice; clicking again removes the vote
3. Zap button generates an LNbits invoice; payment verification adds sats to the idea's sats_pool
4. Sats pool total is visible on the idea card and detail page, updating after payment

### Phase 4: Team Formation
**Goal:** Let builders join and leave idea teams so interested contributors can signal intent and ideas can accumulate a team roster.
**Requirements:** TEAM-01, TEAM-02, TEAM-03
**Success criteria:**
1. Join button on an idea adds the authenticated user to the team and changes to Leave
2. Leave removes the user from the team; the button reverts to Join
3. Idea detail page shows a list of team members with their usernames and avatars
4. Team member count on the idea card updates immediately on join/leave

### Phase 5: Threaded Comments on Ideas
**Goal:** Reuse the existing comment system on ideas so builders can discuss, ask questions, and refine ideas inline.
**Requirements:** CMNT-01, CMNT-02
**Success criteria:**
1. Comment box on the idea detail page submits and renders a new top-level comment
2. Reply to a comment creates a nested thread visually indented under the parent
3. Thread-scoped notifications fire for the idea author and all commenters in the thread when a new reply is posted
4. Comment sort controls (top, newest, oldest, biggest threads) work on idea comments

### Phase 6: Idea-to-Project Conversion
**Goal:** Allow the idea author or an admin to convert an idea into a project, carrying over the sats pool, team, and a back-link so no context or momentum is lost.
**Requirements:** CONV-01, CONV-02, CONV-03, CONV-04
**Success criteria:**
1. Convert button is visible only to the idea author and admins on the idea detail page
2. Conversion creates a new project row with the sats pool set as the initial bounty
3. All current team members are added as project contributors on the resulting project
4. The idea detail page shows a "Converted to project: [project name]" link and the project page links back to the origin idea
5. The converted idea is marked as converted and the Convert button is no longer shown

---

## Milestone: v2.0 — The Living Foyer

*Research basis: `.planning/phases/07-foyer-engagement-research/`*

### Phase 7: Activity Feed and Ambient Signals
**Goal:** Make The Foyer feel alive by showing real-time community activity, solving the empty room problem.
**Requirements:** LIVE-01, LIVE-02, LIVE-03, LIVE-04
**Success criteria:**
1. Activity ticker at the top of The Foyer shows recent actions ("Alice joined Lightning Wallet team 2h ago", "Bob zapped Idea X 100 sats")
2. "Viewed by X people today" counter appears on idea bubbles when view count > 0
3. Recent activity section below the bubbles shows the last 10 actions across The Foyer
4. "Builder online" indicator shows on idea detail when the author is currently on the platform
5. Activity ticker updates without page refresh (polling or live)

### Phase 8: Zap Enhancements
**Goal:** Deepen sats engagement with zap notes, contributor visibility, and sats-weighted ranking to surface genuinely backed ideas.
**Requirements:** ZAP-01, ZAP-02, ZAP-03, ZAP-04
**Success criteria:**
1. Zap flow includes an optional "note" field (message attached to the zap, stored and displayed)
2. Idea cards and detail page show who zapped (named contributors, not just total)
3. "Most Backed" sort option ranks ideas by total sats received, surfacing differently from vote-based ranking
4. Weekly "Top Zappers" callout section on The Foyer highlighting the most generous contributors

### Phase 9: Marketplace Signals
**Goal:** Turn The Foyer into a two-sided marketplace by surfacing what ideas need and what builders offer.
**Requirements:** MKT-01, MKT-02, MKT-03, MKT-04
**Success criteria:**
1. Idea cards support "Looking for" tags (e.g. "Need: designer", "Need: Lightning dev") set by the idea author
2. Builder profiles include an "Available" status with skills and hours/week
3. Idea bubbles show named team members (not just count): "Alice, Bob +2"
4. Notification fires when someone joins your idea's team ("Bob joined your idea")

### Phase 10: Event Integration and Weekly Rhythm
**Goal:** Tie The Foyer to LunarPad's event calendar and create a weekly engagement rhythm.
**Requirements:** EVT-01, EVT-02, EVT-03, EVT-04
**Success criteria:**
1. Next demo day countdown banner appears at the top of The Foyer
2. "Pitch at Demo Day" CTA appears on idea cards when a demo day is upcoming
3. Auto-selected "Idea of the Week" spotlight based on engagement metrics (votes + sats + team joins)
4. Weekly themed periods tied to Lunar Rails product areas (Payments Week, Treasury Week) with visual indicator
5. Weekly digest notification summarizing Foyer activity ("3 new ideas, 500 sats pooled, 2 teams formed")
