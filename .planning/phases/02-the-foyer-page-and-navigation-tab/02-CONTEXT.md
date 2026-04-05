# Phase 2: The Foyer Page and Navigation Tab - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Render the ideas list as a browsable page at /foyer with a nav tab, post idea form, and idea detail page. This phase delivers the frontend. The API from Phase 1 is already complete.

</domain>

<decisions>
## Implementation Decisions

### Page Layout
- **D-01:** Bubble/tag cloud layout. Each idea renders as a bubble/tile. Bigger bubbles = more votes. Organic, non-grid feel. Bubbles float and fill the space naturally.
- **D-02:** Minimal info per bubble: title + vote count only. Click a bubble to navigate to the idea detail page.
- **D-03:** No list/card fallback. Commit to the bubble visual. Sort controls rearrange the bubbles.
- **D-04:** Sort/filter controls at the top (same pill-style filter buttons as comment sorting): Top, Newest, Most Zapped, Biggest Teams.

### Navigation
- **D-05:** "The Foyer" tab in top nav after "Build in Public": Build in Public | Decks | The Foyer
- **D-06:** Tab is active when on /foyer or /foyer/:id.

### Post Idea Flow
- **D-07:** FAB button (same pattern as "Submit Project" on build.html and "Upload Deck" on index.html) labeled "Post Idea".
- **D-08:** Opens a modal with title and description fields. Submit calls POST /api/ideas, then refreshes the bubble view.

### Idea Detail Page (/foyer/:id)
- **D-09:** Simpler than project detail. Centered card with title, full description, author info.
- **D-10:** Vote button, zap button (Phase 3), join button (Phase 4), and team list (Phase 4) as action buttons on the card.
- **D-11:** Comments section below the card (Phase 5, placeholder for now).

### Page Routes
- **D-12:** GET /foyer serves public/foyer.html (list page)
- **D-13:** GET /foyer/:id serves public/foyer-detail.html (idea detail)

### Claude's Discretion
- Bubble sizing algorithm (linear vs logarithmic scaling based on votes)
- Bubble color palette (accent purple gradients, or varied colors)
- Animation on load/sort transitions
- Responsive behavior on mobile (stack bubbles vertically or smaller grid)
- Exact modal styling for post idea form

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing page patterns
- `public/build.html` — FAB button, modal form, card grid layout (closest pattern)
- `public/project.html` — Detail page with vote/zap/comment sections
- `public/css/style.css` — All component styles, CSS variables, comment-filter pills

### API endpoints (Phase 1, already built)
- `server.js` Ideas API section — GET /api/ideas, POST /api/ideas, GET /api/ideas/:id
- `public/js/auth.js` — Shared auth + notification bell (include via script tag)

### Nav bar pattern
- All HTML files — `<nav class="nav-tabs">` with `<a class="nav-tab">` links

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- FAB button pattern: `<button class="fab">` with SVG icon (build.html line 1651)
- Modal overlay: `.modal-overlay` with `.modal-content` and form inside (build.html)
- Filter pills: `.comment-filter` CSS class with `.active` state (style.css)
- `initAuth()` from `/js/auth.js` with page-specific callback
- `timeAgo()`, `esc()` helper functions duplicated per page

### Established Patterns
- Page routes: `app.get('/foyer', requireAuth, (_, res) => res.sendFile(...))` in server.js
- Each page is a self-contained HTML file in public/
- JS inlined in script tags at bottom, calls API endpoints via fetch
- CSS loaded from `/css/style.css`

### Integration Points
- Nav tabs: add "The Foyer" to every HTML file's `<nav class="nav-tabs">` section
- Page routes: add to server.js route block (lines 750-780)

</code_context>

<specifics>
## Specific Ideas

- Bubble visual should feel alive, not static. The foyer is a lively marketplace of ideas.
- Bigger bubbles for popular ideas creates a natural visual hierarchy without needing a sorted list.
- Keep the detail page focused and simple. No sidebar clutter.

</specifics>

<deferred>
## Deferred Ideas

- Vote/zap buttons on detail page wired up — Phase 3
- Join/leave team buttons — Phase 4
- Threaded comments on ideas — Phase 5
- Idea-to-project conversion button — Phase 6

</deferred>

---

*Phase: 02-the-foyer-page-and-navigation-tab*
*Context gathered: 2026-04-05*
