# Phase 4: Team Formation - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Let builders join and leave idea teams. The `idea_members` table exists from Phase 1. This phase adds the API endpoints and wires the frontend buttons.

</domain>

<decisions>
## Implementation Decisions

### API Endpoints
- **D-01:** POST /api/ideas/:id/join (requireAuth): add user to idea_members. Return 409 if already a member.
- **D-02:** POST /api/ideas/:id/leave (requireAuth): remove user from idea_members. Return 404 if not a member.
- **D-03:** Author is separate from team. Posting an idea does not auto-join the author.

### Frontend
- **D-04:** On foyer-detail.html, replace the disabled "Join Team" button with a working toggle. If user is a member, show "Leave Team". If not, show "Join Team".
- **D-05:** Team member list renders below the action buttons on the detail page (already has placeholder from Phase 2).
- **D-06:** After join/leave, refresh the team list and team count without full page reload.
- **D-07:** On the bubble view, no join/leave. Only on the detail page.

### Claude's Discretion
- Whether to show a "You joined!" toast or just update the button
- Team member pill styling details

</decisions>

<canonical_refs>
## Canonical References

- `server.js` idea_members table (Phase 1 migration v011)
- `server.js` GET /api/ideas/:id already returns `members` array with user info
- `public/foyer-detail.html` renderIdea() already renders team members section

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- idea_members table with id, idea_id, user_id, created_at
- GET /api/ideas/:id already JOINs idea_members and returns members array
- bounty_participants pattern (POST /api/bounties/:id/join) as reference

### Integration Points
- Add join/leave endpoints after existing ideas API block in server.js
- Update foyer-detail.html to wire Join Team button and refresh team list

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>

---

*Phase: 04-team-formation*
*Context gathered: 2026-04-05*
