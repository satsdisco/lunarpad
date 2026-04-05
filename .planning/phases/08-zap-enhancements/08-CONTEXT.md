# Phase 8: Zap Enhancements - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deepen sats engagement with zap notes, contributor visibility, sats-weighted ranking, and top zappers recognition.

</domain>

<decisions>
## Implementation Decisions

### Zap Notes
- **D-01:** Add optional `note` TEXT column to zaps table via migration v014.
- **D-02:** POST /api/ideas/:id/zap accepts optional `note` field, stored on the zap record.
- **D-03:** Zap notes displayed on idea detail page in a "Recent Zaps" section showing: zapper name, amount, note, timestamp.
- **D-04:** Zap notes visible only on detail page, not on bubbles.

### Contributor Visibility
- **D-05:** Idea bubbles show total sats received (small badge like views_today badge).
- **D-06:** Idea detail page shows who zapped: list of contributors with name, amount, and note.
- **D-07:** GET /api/ideas/:id/zaps already returns confirmed zaps with user info. Use this for the display.

### Sats-Weighted Sort
- **D-08:** Add "Most Backed" sort option to The Foyer filters. Sorts by total_sats_received descending.
- **D-09:** This is already supported by the API (sort=most_zapped). Just need to rename the filter label or add a new one.

### Top Zappers
- **D-10:** "Top Zappers This Week" section at the top of the activity sidebar.
- **D-11:** API: GET /api/foyer/top-zappers returns top 5 users by total sats zapped on ideas in the last 7 days.
- **D-12:** Display: name + total sats zapped, small ranked list.

### Claude's Discretion
- Exact styling of the zap notes in the detail page
- Whether to show zap note preview in the activity feed items

</decisions>

<canonical_refs>
## Canonical References

- `server.js` POST /api/ideas/:id/zap — add note field
- `server.js` GET /api/ideas/:id/zaps — already returns zap list
- `public/foyer.html` — add sats badge on bubbles, rename filter
- `public/foyer-detail.html` — add zap contributors section
- `public/css/style.css` — zap note and top zappers styling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- GET /api/ideas/:id/zaps already returns confirmed zaps with user_name, amount_sats
- Bubble rendering already has views_today badge pattern to replicate for sats
- Activity sidebar exists for top zappers section

### Integration Points
- Migration v014: note column on zaps
- Update zap endpoint to accept note
- Add GET /api/foyer/top-zappers
- Update foyer.html sidebar and bubble rendering
- Update foyer-detail.html with zap contributors section

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>

---

*Phase: 08-zap-enhancements*
*Context gathered: 2026-04-05*
