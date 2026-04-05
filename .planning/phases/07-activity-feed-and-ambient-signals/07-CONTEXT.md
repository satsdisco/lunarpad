# Phase 7: Activity Feed and Ambient Signals - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Make The Foyer feel alive with an activity feed sidebar and view counts on bubbles. Solve the empty room problem with honest activity signals.

</domain>

<decisions>
## Implementation Decisions

### Activity Feed
- **D-01:** Side panel on the right of The Foyer page, vertical scrollable feed next to the bubble cloud.
- **D-02:** High-signal actions only: zaps, team joins, new ideas, and idea-to-project conversions. No individual votes or comments (too noisy).
- **D-03:** New `activity_log` approach: query recent events from existing tables (zaps, idea_members, ideas, plus converted ideas) rather than creating a separate log table. Build the feed by combining queries.
- **D-04:** API endpoint: GET /api/foyer/activity returns the 15 most recent high-signal actions with actor name, action type, target idea title, and timestamp.
- **D-05:** Feed polls every 30 seconds (same pattern as notification polling).

### View Counts
- **D-06:** Add `views_today` (INTEGER DEFAULT 0) and `views_date` (TEXT) columns to ideas table via migration v013.
- **D-07:** Increment on GET /api/ideas/:id. If views_date != today, reset to 1 and update date. Otherwise increment.
- **D-08:** Show "Viewed by X today" on idea bubbles only when views_today > 0.

### Presence
- **D-09:** Skip builder online indicator for now. Defer to a future phase.

### Layout
- **D-10:** Foyer page becomes a two-column layout: bubbles (left, wider) + activity feed (right, ~280px sidebar).
- **D-11:** On mobile, activity feed collapses below the bubbles.

### Claude's Discretion
- Activity feed item styling (icons, timestamps, truncation)
- Exact responsive breakpoint for sidebar collapse
- Whether to show "X min ago" or relative timestamps in the feed

</decisions>

<canonical_refs>
## Canonical References

- `public/foyer.html` — main Foyer page to add sidebar
- `server.js` ideas API section — add activity endpoint and view tracking
- `public/css/style.css` — add sidebar and two-column layout styles

</canonical_refs>

<code_context>
## Existing Code Insights

### Data Sources for Activity Feed
- `zaps` table: WHERE target_type = 'idea' AND status = 'confirmed' (zap events)
- `idea_members` table: recent joins (team join events)
- `ideas` table: recent created_at (new idea events)
- `ideas` table: WHERE converted_to_project_id IS NOT NULL (conversion events)

### Integration Points
- Add GET /api/foyer/activity endpoint in server.js
- Add view tracking logic to GET /api/ideas/:id
- Update foyer.html layout to two-column with sidebar
- Add polling for activity feed

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
- Builder online indicator — future phase
- Full activity log table — evaluate after seeing if combined queries perform well enough
</deferred>

---

*Phase: 07-activity-feed-and-ambient-signals*
*Context gathered: 2026-04-05*
