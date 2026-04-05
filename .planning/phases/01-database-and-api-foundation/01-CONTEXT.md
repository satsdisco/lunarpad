# Phase 1: Database and API Foundation - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the ideas table, migration, and all CRUD API endpoints so the data layer is complete and testable before any UI exists. This phase delivers the backend only. No HTML pages or navigation changes.

</domain>

<decisions>
## Implementation Decisions

### Database Schema
- **D-01:** Create `ideas` table with: id (TEXT PK, UUID), title (TEXT NOT NULL), description (TEXT), user_id (TEXT), slug (TEXT), total_sats_received (INTEGER DEFAULT 0), created_at (DATETIME DEFAULT CURRENT_TIMESTAMP). Follow exact patterns from existing tables.
- **D-02:** Create `idea_members` table with: id (TEXT PK, UUID), idea_id (TEXT NOT NULL), user_id (TEXT NOT NULL), created_at (DATETIME DEFAULT CURRENT_TIMESTAMP). For team join/leave.
- **D-03:** Add `target_type` column to the `comments` table via migration. Values: 'deck', 'project', 'idea'. Update existing comment queries to include target_type filtering. The existing `deck_id` column becomes `target_id` conceptually but keep the column name for backward compatibility.
- **D-04:** Add migration v011 for ideas + idea_members tables and the comments target_type column.

### API Endpoints
- **D-05:** Follow existing REST patterns. Endpoints:
  - `GET /api/ideas` (list with sort/filter params)
  - `POST /api/ideas` (create, requireAuth)
  - `GET /api/ideas/:id` (detail with vote count, zap total, team size)
  - `DELETE /api/ideas/:id` (requireAuth, author or admin)
- **D-06:** Sort/filter params on GET /api/ideas: `sort=top|newest|oldest|most_zapped|biggest_team`. Default to `top` (most votes).
- **D-07:** Reuse existing vote system: `POST /api/vote` already supports type parameter. Add 'idea' to the allowed types array.

### URL Structure
- **D-08:** Use `/foyer` for the list page and `/foyer/:id` for idea detail. Slug-based short URL at `/f/:slug` (matching `/d/:slug` and `/p/:slug` patterns).

### Claude's Discretion
- Exact column ordering in CREATE TABLE
- Index choices beyond the obvious (slug unique index)
- Whether to add prepared statements to `stmts` object or use inline queries

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema patterns
- `server.js` lines 43-210 — All existing CREATE TABLE statements and migration system
- `server.js` lines 413-437 — Prepared statements object (`stmts`)

### API patterns
- `server.js` lines 1900-2050 — Project CRUD endpoints (closest pattern to ideas)
- `server.js` lines 2345-2394 — Vote system endpoints (add 'idea' type here)
- `server.js` lines 1644-1730 — Zap verify/confirm endpoints (pattern for zap support)

### Comment system
- `server.js` lines 2011-2045 — Project comments (reused for ideas via target_type)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `notify()` helper (line 439): reuse for idea notifications in later phases
- `toSlug()` and `uniqueSlug()` (lines 400-411): reuse for idea slugs
- Vote system (`stmts.addVote`, `stmts.removeVote`, etc.): just add 'idea' to type validation
- Zap infrastructure: same `POST /api/ideas/:id/zap` pattern as projects/decks

### Established Patterns
- All IDs: `crypto.randomUUID()`
- All tables: TEXT PRIMARY KEY, DATETIME DEFAULT CURRENT_TIMESTAMP
- Migrations: versioned array in MIGRATIONS, tracked in _migrations table
- API responses: JSON with `{ error: 'message' }` for errors
- Auth: `requireAuth` middleware on POST/DELETE routes

### Integration Points
- `POST /api/vote`: add 'idea' to the type validation array (line 2348)
- Comment GET/POST endpoints: need target_type awareness for idea comments (Phase 5)
- Slug redirect: add `/f/:slug` route matching `/d/:slug` and `/p/:slug` patterns

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond standard patterns. Follow the established project/deck CRUD conventions exactly.

</specifics>

<deferred>
## Deferred Ideas

- UI rendering of The Foyer page — Phase 2
- Zap endpoint for ideas — Phase 3
- Team join/leave API — Phase 4 (table created here, endpoints later)
- Comments on ideas with target_type — Phase 5
- Idea-to-project conversion — Phase 6

</deferred>

---

*Phase: 01-database-and-api-foundation*
*Context gathered: 2026-04-05*
