# Architecture

**Analysis Date:** 2026-04-05

## Pattern Overview

**Overall:** Monolithic Express.js backend with server-rendered HTML + frontend SPA JavaScript

**Key Characteristics:**
- Single entry point server (`server.js`) handling all HTTP routing, database operations, and business logic
- Static HTML page templates served by routes (SPA-style navigation with hash routing for sections)
- SQLite database with synchronous queries and migration system
- Presentation file serving with path traversal protection (sandboxed iframe delivery)
- Lightning Network integration for payments and "zaps" (micropayments)
- Badge/achievement system driven by user activity
- Multi-domain concern: decks (HTML presentations), events, bounties, projects, users

## Layers

**HTTP/Express Layer:**
- Purpose: Route handling, request/response processing, security headers, middleware chain
- Location: `server.js` (lines 448-550+)
- Contains: 40+ route handlers organized by domain (decks, bounties, events, projects, users, lightning)
- Depends on: Node.js core (crypto, path, fs), express middleware (multer, cookie-session)
- Used by: Client HTTP requests

**Database Layer:**
- Purpose: Persistent storage, schema management, query execution
- Location: `server.js` (lines 37-304, sqlite via `DatabaseSync`)
- Contains: 15 tables (users, decks, projects, bounties, events, votes, comments, zaps, bounty_payments, speakers, rsvps, live_sessions, notifications, project_decks, _migrations)
- Depends on: Node.js `sqlite` module
- Used by: All route handlers via prepared statements (`stmts` object)

**Prepared Statement Cache:**
- Purpose: Performance optimization, SQL injection prevention
- Location: `server.js` (lines 413-445)
- Contains: Pre-compiled statements for all common queries (`stmts.getDecks`, `stmts.setThumbnail`, etc.)
- Pattern: Named exports like `stmts.getUserById.get()`, `stmts.setThumbnail.run()`

**File Upload/Processing Layer:**
- Purpose: Handle deck uploads (ZIP extraction), thumbnail generation, image resizing
- Location: `server.js` (lines 767-857, 2615-2641)
- Contains: Multer middleware for file validation (50MB max), ZIP extraction, PNG/WebP thumbnail generation via Puppeteer
- Depends on: multer, unzipper, puppeteer, sharp (optional)
- Used by: Upload routes (`/api/upload`, `/api/projects/:id/decks/upload`)

**Authentication Layer:**
- Purpose: User identity, session management, permission checks
- Location: `server.js` (lines 553-716)
- Contains: Google OAuth flow, username/password registration/login, cookie-based sessions, admin role checks
- Middleware: `requireAuth()` and `requireAdmin()` guard routes
- Session storage: Cookie-based with rotating secret

**Lightning Network Integration:**
- Purpose: Payment processing, invoice generation, webhook handling
- Location: `server.js` (lines 1191-1822)
- Contains: LNbits API client, LNURL payment handling, invoice verification, webhook verification
- Depends on: LNbits instance (configured via `LNBITS_URL`, `LNBITS_INVOICE_KEY`)
- Flows: Fund bounty → create invoice → verify payment → forward sats to user

**Presentation Serving (Sandboxed):**
- Purpose: Securely serve uploaded HTML presentations in iframe context
- Location: `server.js` (lines 524-550)
- Contains: Path traversal protection (validates UUID, ensures path stays within deck dir), CSP-permissive headers for iframe content
- Pattern: `/presentations/:id/*` routes to `uploads/:id/` filesystem

**Business Logic (Activity/Gamification):**
- Purpose: Badge awarding, leaderboard computation, stats tracking
- Location: `server.js` (lines 306-388, badge check functions)
- Contains: Badge definitions (first_build, first_sats, demo_champ, streak, etc.)
- Trigger: Called on relevant actions (project creation, bounty win, voting)

## Data Flow

**Deck Upload Flow:**

1. User POSTs file to `/api/upload` → multer validates (50MB max, zip extension)
2. File extracted to `uploads/:uuid/` folder
3. Entry point detected via `detectEntryPoint()` (index.html priority, then BFS)
4. Thumbnail generated: Puppeteer loads `/presentations/:uuid/entry.html`, screenshots to WebP
5. Metadata stored in `decks` table with thumbnail path reference
6. Frontend loads deck list from `/api/decks`, renders gallery with thumbnails

**Bounty Payment Flow:**

1. User clicks "Fund Bounty" → `/api/bounties/:id/fund` (requireAuth)
2. Server calls LNbits `/api/v1/invoices` to create payment request
3. Payment request stored in `bounty_payments` table with status='pending'
4. Frontend polls `/api/lightning/verify/:payment_id` for confirmation
5. Webhook from LNbits → `/api/webhook/lnbits` verifies signature, updates payment status
6. If bounty funded, server forwards sats to winner's lightning address via `/forward` endpoint
7. Notifications created for relevant users

**Project "Zap" (Micropayment) Flow:**

1. User clicks zap icon on project → `/api/projects/:id/zap` (requireAuth)
2. Server creates `zaps` record with status='pending', calls LNbits for invoice
3. Frontend polls `/api/zaps/verify/:zap_id` until confirmed
4. On confirmation, forwards sats to project owner's lightning address
5. Updates `project.total_sats_received`, triggers badge checks

**Authentication Flow:**

1. User accesses protected route → middleware checks session.userId
2. If found, loads user from DB via `stmts.getUserById.get(userId)`
3. If missing and not production, auto-login as dev user (alice/bob)
4. If still no user and route is `/api/*`, returns 401; else redirects to `/welcome`
5. Google OAuth: `/auth/google` → redirects to Google, callback creates/updates user

**Page Navigation (SPA-style):**

1. Request `/` → `build.html` served (requires auth)
2. JavaScript on page loads data from `/api/` endpoints
3. Client-side routing via hash (#events, #projects, #bounties, etc.)
4. Static pages for non-SPA routes: `/deck/:id`, `/profile/:id`, `/event/:id`, etc.

## Key Abstractions

**Prepared Statement Cache (`stmts`):**
- Purpose: Centralized query definitions, injection prevention, performance
- Examples: `stmts.getUserById`, `stmts.setThumbnail`, `stmts.allTags`
- Pattern: `.get()` for single row, `.all()` for multiple, `.run()` for mutations

**Badge System:**
- Purpose: Gamification rewards for user engagement
- Examples: `BADGES.first_build`, `BADGES.demo_champ`
- Trigger: `checkAndAwardBadges(userId)` called after relevant actions
- Storage: JSON array in `users.badges` column

**Slug-based Routing:**
- Purpose: Human-readable URLs for decks/projects
- Pattern: `/d/:slug` → lookup deck, `/p/:slug` → lookup project
- Constraint: Unique index on non-null slugs

**Migration System:**
- Purpose: Evolutionary database schema management
- Location: `_migrations` table tracks applied migrations
- Pattern: Name-based idempotence (each migration runs exactly once)
- Example: v001 adds lightning_address, v002 adds bounty_fields, etc.

**Presentation Sandbox:**
- Purpose: Safely execute untrusted HTML/JS from uploaded decks
- Security: Path traversal validation, iframe CSP relaxation, same-origin framing
- Entry: `/presentations/:deckId/:filePath` (no auth required, public viewing)

## Entry Points

**Server:**
- Location: `server.js` (line 3163)
- Triggers: `npm start` (runs `node server.js`) or `npm run dev` (with --watch)
- Responsibilities: Boot Express app, initialize database, run migrations, seed demo decks

**HTTP Entry Points (Page Routes):**
- `/welcome` - public login page (no requireAuth guard)
- `/` - build.html (main SPA)
- `/decks`, `/deck/:id`, `/upload` - deck management
- `/event/:id`, `/project/:id`, `/bounty/:id` - detail pages
- `/profile/:id` - user profile
- `/admin` - admin dashboard (guards with requireAdmin)

**API Entry Points:**
- `/api/decks` - list/search decks
- `/api/bounties/*` - bounty operations
- `/api/events/*` - event operations
- `/api/projects/*` - project operations
- `/api/lightning/*` - payment flows
- `/api/webhook/lnbits` - inbound payment webhooks

## Error Handling

**Strategy:** Inline error responses (JSON for /api/*, HTML redirect for pages)

**Patterns:**
- Missing data: Returns 404 or `{ error: 'Not found' }`
- Invalid input: Returns 400 with validation message
- Unauthorized: Returns 401 for API, 302 redirect to /welcome for pages
- Forbidden: Returns 403 for insufficient permissions
- Server errors: Multer error handler (line 2676) catches upload errors, returns 413 for oversized files
- Database errors: Most queries wrapped in try/catch, but some fail silently (migrations ignore "already exists")

## Cross-Cutting Concerns

**Logging:** Console.log for startup, migrations, errors; no structured logging framework

**Validation:** 
- File uploads: multer MIME type, size, extension checks
- IDs: UUID format validation for presentation serving (`/^[0-9a-f-]{36}$/i`)
- Lightning addresses: Regex pattern `/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/`

**Authentication:** Cookie-session middleware (line 481), session secret from env, rolling session refresh

**Security Headers:** Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, HSTS (production only)

**Thumbnails/Images:** Optional sharp resize; Puppeteer screenshot for deck thumbnails

---

*Architecture analysis: 2026-04-05*
