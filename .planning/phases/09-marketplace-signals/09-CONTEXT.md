# Phase 9: Marketplace Signals - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn The Foyer into a two-sided marketplace with "looking for" tags on ideas, builder availability on profiles, named team on bubbles, and team join notifications.

</domain>

<decisions>
## Implementation Decisions

### "Looking for" Tags
- **D-01:** Preset list of roles: Designer, Frontend Dev, Backend Dev, Lightning Dev, Marketing, Tester. No freeform.
- **D-02:** Add `looking_for` TEXT column on ideas table (migration v015). Store as comma-separated string (same pattern as project tags).
- **D-03:** Post Idea modal gains a multi-select chip picker for roles needed.
- **D-04:** Idea detail page shows "Looking for: Designer, Lightning Dev" badges.
- **D-05:** Idea bubbles show a small indicator when the idea has "looking for" tags set (e.g. small people icon).

### Builder Availability
- **D-06:** Add `skills` TEXT and `available_hours` INTEGER columns to users table (migration v015).
- **D-07:** Profile page (/profile) gets an "Availability" section where users can set their skills (multi-select from same preset list) and hours/week.
- **D-08:** Update PUT /api/users/:id or add a dedicated endpoint to save skills + hours.
- **D-09:** When viewing someone's profile, their skills and availability are visible.

### Named Team on Bubbles
- **D-10:** Idea bubbles show named team members: "Alice, Bob +2" instead of just a count.
- **D-11:** GET /api/ideas list endpoint already returns team_size. Need to also return first 2 member names. Add a subquery or join.

### Team Join Notification
- **D-12:** When someone joins an idea's team, notify the idea author.
- **D-13:** Notification type 'team_join', target_type 'idea'.

### Claude's Discretion
- Chip picker styling for role selection
- How to display skills on profile page
- Exact bubble indicator for "looking for" tags

</decisions>

<canonical_refs>
## Canonical References

- `server.js` ideas table, idea_members table
- `server.js` users table, profile endpoints
- `public/foyer.html` bubble rendering, post idea modal
- `public/foyer-detail.html` idea detail rendering
- `public/profile.html` profile page

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Project tags use comma-separated TEXT field, same pattern for looking_for and skills
- notify() helper for team join notifications
- Bubble rendering already supports badges (views, sats, converted)

### Integration Points
- Migration v015: looking_for on ideas, skills + available_hours on users
- Update POST /api/ideas to accept looking_for
- Update POST /api/ideas/:id/join to fire notification
- Update GET /api/ideas to return first 2 member names
- Update foyer.html bubble rendering for named team + looking-for indicator
- Update foyer-detail.html for looking-for badges
- Update profile.html for availability section

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>

---

*Phase: 09-marketplace-signals*
*Context gathered: 2026-04-05*
