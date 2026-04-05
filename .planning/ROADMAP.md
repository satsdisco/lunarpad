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
