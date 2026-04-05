<!-- GSD:project-start source:PROJECT.md -->
## Project

**LunarPad**

LunarPad is an internal platform for Lunar Rails' BuildInPublic initiative. Builders upload HTML presentations, showcase projects, compete in demo days, earn sats through bounties, and engage through voting, zapping, and threaded comments. It runs on Node.js/Express with SQLite and vanilla HTML/CSS/JS.

**Core Value:** Give Bitcoin builders a living home to share work, compete, and earn sats, replacing scattered Slack threads with a gamified platform.

### Constraints

- **Tech stack**: Node.js, Express, SQLite, vanilla HTML/CSS/JS. No frameworks, no build step.
- **Design**: Dark navy (#0d0f1a), purple (#7c5cfc), gold (#d4a843). Space Grotesk + Inter fonts.
- **Deployment**: Push to staging branch for testing at decks.satsdisco.com.
- **Lightning**: LNbits for invoice generation and payment verification.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Purpose
## Language & Runtime
- **Node.js** (runtime) - embedded SQLite via `node:sqlite`
- **JavaScript** (server-side) - ES6+ with async/await
- **HTML/CSS/JavaScript** (client-side) - browser-based UI in `public/`
## Core Framework & Server
- **Express.js** `^4.18.2` - HTTP server framework for routing, middleware
- **Port**: 3100 (configurable via `PORT` env var)
## Authentication & Sessions
- **Google OAuth 2.0** (optional)
- **Session Management** via `cookie-session` `^2.1.1`
- **Password Hashing**: `bcryptjs` `^3.0.3` - bcrypt hashing for local accounts
## Database
- **SQLite** (embedded via `node:sqlite` module)
## File Handling
- **Upload Processing**: `multer` `^1.4.5-lts.1` - middleware for file uploads
- **ZIP Extraction**: `unzipper` `^0.12.3` - extract uploaded deck archives
- **Directories** (auto-created):
## Image Processing
- **Sharp** `^0.34.5` (optional, gracefully degraded if unavailable)
## QR Code & Media Generation
- **QRCode** `^1.5.4` - generate Lightning payment QR codes
- **Puppeteer** `^21.11.0` - headless browser automation
## Configuration & Environment
- **dotenv** `^17.4.0` - load environment variables from `.env` file
- **.env.example** (template):
- **Runtime env vars** (see `server.js` config section):
## Lightning/Bitcoin Integration
- **LNbits** API (webhook-based payment confirmation)
- **LNURL Protocol** (Lightning address resolution)
## Security & Middleware
- **CORS & CSP** headers:
- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: SAMEORIGIN
- **Permissions-Policy**: browser feature restrictions
- **Body parsers**: JSON + URL-encoded (extended)
## Frontend Assets
- **CSS**: `public/style.css` (123KB)
- **JS Bundles**: 
- **HTML Pages**:
## API Endpoints (Summary)
- **Auth**: `/auth/google`, `/auth/google/callback`, `/api/login`, `/api/register`, `/api/logout`
- **User**: `/api/user`, `/api/admin/promote`
- **Decks**: `/api/deck/*`, `/api/decks`, `/api/deck/upload`, `/api/deck/*/publish`
- **Projects**: `/api/project/*`, `/api/projects`
- **Bounties**: `/api/bounty/*`, `/api/bounties`
- **Events**: `/api/event/*`, `/api/events`
- **Payments**: `/api/pay/lightning`, `/api/zap`, `/api/bounty-payment`
- **Webhooks**: `/api/webhook/lnbits` - LNbits payment confirmations
- **Live**: `/api/live-event`, `/api/live-speaker`
## Package.json
- **Name**: deckpad
- **Version**: 1.0.0
- **Main**: server.js
- **Scripts**:
- **Location**: `package.json` at project root
## File Paths Reference
- Main server: `server.js` (3,186 lines)
- Dependencies: `package.json`, `package-lock.json`
- Database file: `deckpad.db` (created at runtime)
- Config template: `.env.example`
- Frontend: `public/` directory tree
- Node modules: `node_modules/` (224 packages)
- Data storage: `uploads/`, `thumbnails/`, `avatars/`, `temp/` directories
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Purpose
## Code Style
### JavaScript
- All files use `'use strict';` at the top (`server.js` line 1)
- No relaxed execution semantics
- 2-space indentation (not tabs)
- No trailing semicolons (except where required for statement termination)
- Lines reasonably wrapped; no hard limit enforced visually
- `const` for immutable values (preferred)
- `let` for mutable state (rarely used, prefer const)
- `var` avoided entirely
- All config constants in UPPER_SNAKE_CASE and grouped at top of file
- Inline comments rare; code is self-documenting
- Section dividers use 80-char lines with em dashes and descriptive text
- No block comments; prefer clear function/variable names
- Trailing comments on same line avoided
- camelCase for variables, functions, event handlers
- UPPER_SNAKE_CASE for constants
- Private functions/state prefixed with `_` (example: `_notifInterval`, `_currentUser` in auth.js)
- Database-related functions use descriptive verbs: `checkAndAwardBadges()`, `resolveLnAddress()`, `cachedBadgeCheck()`
- SQL statement map uses descriptive keys: `findUserByGoogleId`, `incrementView`, `getUnreadCount` (server.js lines 413-437)
- try/catch used extensively for async operations and user-facing errors
- Error messages are descriptive and include context
- Silent failure pattern: empty catch blocks swallow errors with optional console.warn
- Validation failures return 400 with JSON error object: `{ error: 'message' }`
- Auth failures return 401; permission failures return 403
- Missing resources return 404; resource conflicts return 409
### Server (Express)
- Middleware applied in logical order: security → parsing → auth → routing (server.js lines 449-521)
- App configuration (disable headers, set trust proxy) applied early
- Auth middleware applied per-route, not globally; allows public routes to coexist
- Security headers applied in single middleware (server.js lines 451-474)
- HSTS, CSP, Permissions-Policy all set explicitly
- Session management uses cookie-session with rolling sessions (server.js lines 481-495)
- Dev auto-login checks `!process.env.BASE_URL` (server.js line 502)
- Auth routes grouped together (server.js lines 553-687)
- Page routes grouped and share requireAuth middleware (server.js lines 720-751)
- API routes organized by resource (bounties, events, decks, zaps, payments)
- Slug-based short URLs use 301 redirects for permanence (server.js lines 754-763)
- Always return JSON with `{ error: 'message' }` for API routes
- Always return descriptive HTTP status codes
- Null/missing data: return 404, not 500
- Already exists: return 409 Conflict
- Validation: return 400 Bad Request
### Client JavaScript
- No module system; globals used directly (window scope)
- State stored in closure variables: `let currentPage = 1;` (index.html line 52)
- Initialization function pattern: `initAuth()`, `loadDecks()`, `pollNotifications()` 
- Event listeners registered after DOM is ready
- Handler functions prefixed with verb: `loadTags()`, `pollNotifications()`, `markRead()`
- Helper utilities grouped by concern: date formatting (`timeAgo()`), escaping (`escHtml()`)
- DOM query results stored and reused (avoid re-querying): `const area = document.getElementById('userArea');` (auth.js line 9)
- Private data marked with underscore prefix: `_currentUser`, `_notifInterval` (auth.js lines 2-3)
- innerHTML used for bulk HTML generation (auth.js lines 13-46)
- classList used for styling toggles: `.classList.toggle('open')`, `.classList.add('active')`
- Event delegation where efficient: `document.addEventListener('click', e => { ... })` (auth.js lines 49-57)
- Aria labels used for accessibility: `aria-label="Notifications"` (auth.js line 15)
- async/await used for fetch calls
- fetch errors silently caught: `try { ... } catch { return; }` (index.html line 60-63)
- Polling intervals managed with explicit variables: `_notifInterval = setInterval(...)` (auth.js line 73)
- Visibility API used to pause polling when tab hidden (auth.js lines 76-83)
### CSS
- CSS custom properties (--name) defined in :root for theming (style.css lines 5-32)
- Color palette: --bg, --surface, --text, --accent, --gold, --danger
- Spacing: --radius, --radius-lg
- Fonts: --font, --font-mono
- Semantic naming over hex codes everywhere
- Properties separated by semicolons on single line for compact declarations: `display: flex; align-items: center;` (style.css line 59)
- Selectors and rules organized by component/section
- No ID selectors in CSS; classes used throughout
- Attribute selectors used for state: `input[type="text"]`, `button[disabled]`
- BEM-like naming: `.nav-tab`, `.nav-tab.active`, `.header-left` (style.css lines 68-93)
- Pseudo-classes for interactive states: `:hover`, `:focus`, `:checked`, `::selection`
- Pseudo-elements: `::before`, `::after` only when necessary
- Child combinators used sparingly, reliance on classes
- rem-based sizing for scalability
- px used for borders and very small values (1px)
- Viewport-relative units (vh, vw) avoided unless intentional
- Gaps, padding, margins use rems or px depending on context
- All transitions explicitly declared: `transition: color .15s;` (style.css line 86)
- Duration always specified in milliseconds: `.15s`, `.2s`, `1s`
- No blanket `transition: all` pattern
## Database
- All tables created with CREATE TABLE IF NOT EXISTS (server.js line 43)
- All IDs are TEXT PRIMARY KEY, typically UUID-formatted
- Timestamps use DATETIME DEFAULT CURRENT_TIMESTAMP
- Foreign keys use TEXT references, not numeric IDs
- Nullable fields use NULL, not empty string or 0
- Tracked in _migrations table with name and applied_at timestamp (server.js lines 213-217)
- Each migration tracked by name; runs exactly once
- Duplicate column/exists errors silently ignored (server.js lines 297-298)
- Migration names versioned: v001, v002, v003, etc.
- All SQL uses prepared statements with ? placeholders
- Statement map stored in `stmts` object for reuse (server.js lines 413-437)
- Direct db.prepare() calls inline for one-off queries
- Parameters bound using positional (?) or named (@) syntax
- NULL used to represent missing data
- COALESCE() used to provide defaults in queries: `COALESCE(avatar, ?)` (server.js line 598)
- Optional fields NOT NULL DEFAULT with sensible defaults (0, empty string, false)
## Testing
## File Organization
- Imports and 'use strict' (line 1)
- Config constants (line 18)
- Database schema and migrations (line 37)
- Badge system (line 306)
- Helper functions (slug, notify, etc.) (line 398)
- Express app initialization (line 448)
- Routes grouped by resource (auth, pages, API)
- Server listen at end (not shown)
- DOCTYPE and meta tags
- External stylesheet link
- Semantic HTML structure
- Inline script tag with module-pattern JavaScript
- No separate JS files needed for single-page logic
- CSS variables at :root
- Reset styles (box-sizing, margins, padding)
- Typography (fonts, sizes, line-height)
- Component styles (button, nav, card)
- Layout utilities (container, grid)
- Responsive adjustments (media queries)
## Key Decisions
## Anti-Patterns to Avoid
- String concatenation in SQL queries (always use ?)
- Global state without underscore prefix
- Unhandled promise rejections (all async wrapped in try/catch)
- Hardcoded values in code (use env vars or config constants)
- console.log for production logs (use console.error with prefix)
- Direct innerHTML with user input (escHtml() used in auth.js line 168)
- Inline onclick handlers on modern elements (use addEventListener)
- Magic numbers without named constants
- CSS with !important (never used; rely on specificity)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Overview
## Core Patterns
### 1. Layering
- Entry points: `server.js` main file, route definitions at line 449+
- Middleware stack: security headers, auth, static serving, JSON parsing
- Route handlers: mostly thin HTTP wrappers that call query functions
- Error handling: 404 catch-all (line 3170), multer error middleware (line 3176)
- Embedded in route handlers (no separate service layer)
- Badge system (lines 306-396): `checkAndAwardBadges()`, `cachedBadgeCheck()`
- Slug generation (lines 400-411): `toSlug()`, `uniqueSlug()`
- Notifications (line 439): `notify()` helper
- Thumbnail generation (referenced via `generateThumbnail()`, Puppeteer-based)
- Lightning payment flows (multiple routes for LNBits integration)
- SQLite via `node:sqlite` module (native sync driver)
- Prepared statements in `stmts` object (lines 413-437)
- Raw SQL queries inline in route handlers (widespread)
- Migration system (lines 211-304): versioned migrations in MIGRATIONS array, tracked in _migrations table
### 2. Authentication & Session
- **Cookies**: `cookie-session` middleware (line 481), 7-day expiry, secure in production
- **Multi-auth**: Google OAuth (lines 553-641), username/password registration (lines 642-668), dev auto-login (lines 501-515)
- **User resolution**: Auto-loaded from database via `req.session.userId` in middleware (lines 498-500)
- **Dev mode**: Auto-creates test users (alice/bob) when no BASE_URL set (lines 502-515)
- **Admin check**: Simple boolean flag on user record, `requireAdmin` middleware (implied in routes)
### 3. Static File Serving
- **Public assets**: Express static middleware for `/public` (line 520), no index so auth wall controls `/`
- **User uploads**: `/presentations/:id` route (line 526) serves deck files from `UPLOADS_DIR`
- **Traversal protection**: UUID validation + path normalization (lines 528-538) prevents directory escape
- **Presentation sandbox**: Loosened CSP for iframes (line 543), SAMEORIGIN framing (line 540)
- **Avatars/Thumbnails**: Separate static routes for `/avatars` and `/thumbnails` (lines 521-522)
### 4. Data Models
- `users`: id, google_id, username, email, name, avatar, password_hash, is_admin, plus extensions (badges, lightning_address, bio, website_url, github_url)
- `decks`: id, title, author, description, tags, filename, entry_point, views, thumbnail, github_url, demo_url, uploaded_by, slug, hidden, total_sats_received
- `projects`: id, name, builder, description, status, tags, category, bounty_id, user_id, deck_id, repo_url, demo_url, slug, banner_url, thumbnail_url, total_sats_received
- `bounties`: id, title, description, sats_amount, deadline, status, tags, event_id, winner_id, winner_name, paid_out, funded_amount
- `events`: id, name, description, event_type, date, time, location, virtual_link
- `comments`: id, deck_id, user_id, author_name, content, created_at, parent_id (nested threading)
- `votes`: (target_type, target_id, voter_ip) composite key, IP-based (no login needed for voting)
- `zaps`: id, target_type, target_id, user_id, user_name, amount_sats, payment_hash, status, plus forward fields
- `bounty_payments`: Similar to zaps, tied to bounties instead
- `project_decks`: Links projects to multiple deck versions with version number and "is_current" flag
- `bounty_participants`: Track who joined a bounty
- `speakers`: Link people to events with project details
- `rsvps`: Track event attendance
- `notifications`: Feeds for user activity (votes, comments, zaps, replies)
### 5. Request/Response Patterns
- Resource endpoints: `/api/decks`, `/api/projects`, `/api/bounties`, `/api/events`
- Nested resources: `/api/projects/:id/decks`, `/api/projects/:id/comments`, `/api/projects/:id/zaps`
- Actions: `/api/bounties/:id/join`, `/api/bounties/:id/fund`, `/api/bounties/:id/approve-winner`
- Queries: `/api/leaderboard?sort=earners|zappers|projects|active`, `/api/vote/count`, `/api/vote/check`
- JSON request/response bodies throughout
- Auth wall: `/` redirects to `/build` (line 725), all routes `requireAuth` except `/welcome` (line 720)
- Canonical routes: `/decks`, `/upload`, `/deck/:id`, `/build`, `/events`, `/projects`, `/bounties`, `/leaderboard`
- Detail pages: `/event/:id`, `/project/:id`, `/profile`, `/profile/:id`, `/bounty/:id`
- Admin: `/admin`, live event: `/live/:eventId`
- Slug routes: `/d/:slug` and `/p/:slug` for decks and projects (lines 754-795)
- Legacy redirects: `/event/`, `/project/`, `/bounty/` redirect to `/#section` (lines 731-742)
### 6. File Upload Flow
- Multer single file, max 50MB (security header line 3178)
- If `.zip`: unzip to `UPLOADS_DIR/{deckId}/`, detect entry point, preserve original
- If `.html` or other: copy to `{deckId}/index.html`
- Auto-generate thumbnail via `generateThumbnail()` (Puppeteer) async
- Store deck metadata (title, tags, entry_point) in DB
- Return deck ID for linking
- Similar flow but creates `project_decks` entry with version number
- Sets `is_current = 1` and marks previous versions as not current
- Linked deck gets `hidden = 1` so it doesn't appear in public gallery
### 7. Lightning Integration
- Route: `POST /api/lightning/webhook` (line 1765)
- Incoming webhooks confirm pending zaps and bounty payments
- Updates status from "pending" to "confirmed" + timestamp
- Triggers badge checks and notification propagation
- `POST /api/bounties/:id/fund`: Create bounty_payment (fund type)
- `POST /api/projects/:id/zap` / `POST /api/decks/:id/zap`: Create zap entries
- `GET /api/lightning/verify/:payment_id`: Poll LNBits for status (callback pattern)
- `POST /api/lightning/resolve`: Resolve payment request from invoice string
- `POST /api/lightning/invoice`: Generate invoice from amount
- Admin can retry forwards for failed zaps (line 1180)
- Forwards stored in zaps table (forward_status, forward_payment_hash fields)
- Resolves to user's lightning_address if set
### 8. Notifications
### 9. Badge System
- Checked on demand via `cachedBadgeCheck()` (rate-limited to 60s intervals per user)
- Deterministic SQL queries for each badge condition
- Stored as JSON array on users.badges
- `/api/users/:id` endpoint triggers check before returning user (line 2271)
- Could be called elsewhere but not clear from grep
## Data Flow: Key Scenarios
### Upload & Present
### Bounty Completion & Payment
### Vote & Leaderboard
## File Serving & Sandboxing
- `/public` directory served as-is (HTML, CSS, JS, images)
- HTML files in public/ are thin shells that fetch from API then render
- `/presentations/:id` is custom middleware (line 526-548)
- Validates UUID format, normalizes path, checks containment
- Sets SAMEORIGIN CSP and relaxed CSP for frame content
- Delegates to `express.static(deckDir)` for actual file serving
- `uploads/` tree by deck UUID: user-uploaded HTML/ZIP content
- `thumbnails/` tree by deck UUID: auto-generated PNGs
- `avatars/` user profile pictures
## Security Posture
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY (relaxed to SAMEORIGIN for presentations)
- X-XSS-Protection: 1; mode=block
- HSTS: 1-year, includeSubDomains (production only)
- Permissions-Policy: Locks down camera, mic, geolocation, payment, USB, motion sensors
- CSP: Restricts to self + CDNs (googleapis, cdn.jsdelivr.net)
- Multer with 50MB limit
- ZIP extraction validated via unzipper module
- Path traversal blocked at presentation route (UUID + normalization)
- Secure cookies in production
- SameSite=lax
- 7-day expiry rolling
- HttpOnly flag set
- No raw user input in SQL (prepared statements throughout)
- Foreign keys disabled by default (line 42) but migration system handles integrity
- IP-based for unauthenticated users (voter_ip field in votes table)
- Prevents single-user multi-voting but not botnet voting
## Entry Points
- `node server.js` loads `server.js` (3186 lines)
- Initializes SQLite DB (auto-creates schema if tables don't exist)
- Runs migrations
- Binds Express on PORT (default 3100)
- Seeds demo decks and platform data if missing
- Public pages (HTML): `/welcome`, `index.html`, `build.html`, `deck.html`, `event.html`, etc.
- All require auth (middleware at line 725) except welcome
- JavaScript: `/public/js/auth.js` (shared auth + notifications)
- CSS: `/public/css/style.css` (monolithic, 121KB)
- `/api/*` routes defined throughout server.js
- Auth required on most (POST/PUT/DELETE, some GETs)
- Public GETs: `/api/decks`, `/api/projects`, `/api/leaderboard`, `/api/events`
## Technology Stack
- **Server**: Node.js + Express 4.18
- **Database**: SQLite via node:sqlite (native, sync API)
- **Session**: cookie-session (not Express-session)
- **Auth**: Google OAuth (fetch calls to Google), local register/login
- **File Upload**: multer 1.4.5 (LTS)
- **Image Generation**: Puppeteer 21.11 (for thumbnails), sharp 0.34 (optional image processing)
- **Lightning**: LNBits REST API (external)
- **Utilities**: crypto (UUIDs), path (file traversal), fs (file I/O), unzipper, qrcode
## Database Structure
- decks.uploaded_by -> users.id
- comments.deck_id -> decks.id
- projects.user_id -> users.id
- bounties.event_id -> events.id
- bounty_payments.bounty_id -> bounties.id
- project_decks.project_id -> projects.id
- project_decks.deck_id -> decks.id
- `idx_decks_slug` unique on decks(slug)
- `idx_projects_slug` unique on projects(slug)
- `idx_comments_parent` on comments(parent_id)
- `idx_notif_user` composite on notifications(user_id, read, created_at)
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
