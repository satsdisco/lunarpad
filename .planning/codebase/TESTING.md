# Testing Patterns

**Analysis Date:** 2026-04-05

## Test Framework

**Status:** No testing framework detected

**Runner:**
- No test runner configured (no `jest.config.js`, `vitest.config.js`, or test command in `package.json`)
- No test files present in codebase (no `.test.js` or `.spec.js` files)

**Assertion Library:**
- Not applicable — no test framework in use

**Run Commands:**
```bash
# No test scripts configured
# Development: npm run dev    # node --watch server.js
# Production: npm start       # node server.js
```

## Test File Organization

**Current State:** No test files

**Recommended Structure (if testing were to be added):**
```
project-root/
├── server.js                    # Main server
├── __tests__/                   # Test directory (if created)
│   ├── auth.test.js
│   ├── api/
│   │   ├── decks.test.js
│   │   ├── bounties.test.js
│   │   └── lightning.test.js
│   ├── helpers/
│   │   ├── slug.test.js
│   │   └── badge.test.js
│   └── fixtures/
│       ├── users.js
│       └── decks.js
```

**Naming Convention:**
- Test files should follow pattern: `[module].test.js`
- Test directories: `__tests__/` (preferred) or colocated

## Areas Lacking Test Coverage

### Critical Business Logic (No Tests)

**Authentication & Authorization (server.js:551-708)**
- Google OAuth2 callback and user linking logic
- Session management and rolling sessions
- Admin permission checks
- Dev user switcher (localhost only)

**Risk:** OAuth linking bugs could cause account confusion or security issues

**Badge System (server.js:306-396)**
- `checkAndAwardBadges()` calculates 10 different badge types
- Complex query logic with multiple conditions
- Badge persistence (JSON.stringify/parse)

**Risk:** Badges could be awarded incorrectly; logic is fragile with hardcoded thresholds

**Lightning/LNURL Integration (server.js:1191-1401)**
- Payment verification workflow
- Invoice generation and payment request handling
- Automatic zap forwarding
- Lightning address resolution

**Risk:** Payment logic is error-prone; failed payments or forwarding could silently fail or cause funds loss

**Payment Processing (server.js:1620-1760)**
- Webhook verification for LNbits
- Payment confirmation and status tracking
- Bounce payment retry logic

**Risk:** Webhook bugs could cause duplicate payments or missed confirmations

**Database Migrations (server.js:211-304)**
- Migration system tracks already-applied migrations
- Ignores expected errors (duplicate column warnings)
- ALTER TABLE operations without rollback

**Risk:** Migration failures could corrupt schema; no rollback mechanism

**Upload & File Handling (server.js:797-855)**
- ZIP extraction and entry point detection
- Thumbnail generation with Puppeteer
- File validation and cleanup on error

**Risk:** File handling bugs could cause resource leaks or security issues

### Untested Functions

**Entry Point Detection (server.js:2592-2613)**
- Recursive directory search for HTML files
- Multiple fallback patterns (index.html, slides.html, etc.)
- Depth limit to prevent infinite traversal

**Risk:** Could fail with unusual ZIP structures; malformed searches could hang

**Thumbnail Generation (server.js:2615-2641)**
- Puppeteer launch with Chrome detection
- Screenshot capture with viewport settings
- Browser process cleanup

**Risk:** Browser resource leaks; Chrome path detection brittle

**Query Filtering (server.js:860-903)**
- Complex SQL with dynamic conditions
- Tag filtering with multiple LIKE patterns
- Pagination offset calculations

**Risk:** SQL injection via search/tags not properly validated; logic could produce incorrect results

**Comments & Voting (server.js:2468-2533)**
- Comment threading with parent_id
- Vote tracking and notification dispatch
- Reply notifications to multiple users

**Risk:** Comment threads could break with missing parent; notifications could duplicate

## Database Verification

**Current Testing Method:** Manual database inspection and seed data

- Seed presentations created on startup: `seedDemoDecks()`
- Platform data inserted on startup: `seedPlatformData()`
- Database persists across restarts with `CREATE TABLE IF NOT EXISTS`

**Issues:**
- No database schema validation
- No constraints except PRIMARY KEY and FOREIGN KEY
- No triggers for cascading deletes

## API Endpoint Coverage Gaps

**Untested Endpoints:**

**Bounties:**
- `POST /api/bounties/:id/join` (line 1035-1047) — bounty participation
- `DELETE /api/bounties/:id/leave` (line 1050-1056) — leave bounty
- Winner assignment and payment approval

**Events:**
- `GET /api/events` (line 1060-1072) — complex JOIN with vote aggregation
- Event deletion with cascading speaker/RSVP cleanup

**Projects:**
- Create, update, delete projects (complex with multiple related records)
- Project deck versioning

**Live Presenter Mode:**
- `POST /api/live/:eventId/speaker` (line 2584-2588) — current speaker updates
- `GET /api/live/:eventId` (line 2544-2562) — live state polling

**Admin Routes:**
- `/api/admin/forwards` and retry logic
- Payment summary aggregation queries

## Async & Error Boundary Testing

**Async Patterns (Untested):**

```javascript
// Line 844-846: Fire-and-forget thumbnail generation
generateThumbnail(id, entryPoint).catch(err => {
  console.warn(`[thumb] ${id}: ${err.message}`);
});

// Line 1187: Retry zap forwarding
autoForwardZap(freshZap).catch(e => console.error('[retry forward]', e.message));
```

**Risk:** Errors in async operations logged but not surfaced to clients; silent failures possible

## Import & Dependency Testing

**External Dependencies (Untested Integration):**
- `puppeteer` — screenshot generation
- `bcryptjs` — password hashing
- `multer` — file upload
- `unzipper` — ZIP extraction
- `qrcode` — QR code generation
- `sharp` — image optimization (optional, graceful degradation)
- `cookie-session` — session management
- Google OAuth2 API
- LNbits API (Lightning payment service)

**Mock Candidates:**
- External HTTP calls (Google, LNbits)
- File system operations (fs, path)
- Puppeteer (browser automation)
- Database (SQLite)

## Mocking Opportunities

**High Priority:**

1. **HTTP Clients** (Google OAuth, LNbits)
   ```javascript
   // Should mock fetch() for OAuth callback, payment APIs
   // Current: Direct fetch() calls with no isolation
   ```

2. **File System**
   ```javascript
   // Should mock fs.createReadStream, fs.mkdirSync, fs.unlinkSync
   // Risk: Tests could accidentally delete real files
   ```

3. **Database**
   ```javascript
   // Should use test database or transaction rollback
   // Current: Using live deckpad.db even in test scenarios
   ```

4. **Puppeteer**
   ```javascript
   // Should mock screenshot generation
   // Current: Launches real browser, slow and resource-intensive
   ```

## Security Testing Gaps

**CSRF Prevention:** No CSRF token validation detected
- Session-based auth relies on httpOnly cookies
- POST endpoints don't validate CSRF tokens
- GET endpoints can't modify state (correct)

**SQL Injection:** Prepared statements used, appears safe
- All dynamic values parameterized
- Tag filtering uses LIKE with concatenation but safe (parameterized)

**Access Control:** Basic RBAC implemented
- `requireAuth` middleware checks login
- `requireAdmin` middleware checks is_admin flag
- Deck deletion checks ownership: `deck.uploaded_by !== req.user?.id`

**Untested:**
- Cross-origin request validation
- Rate limiting (not implemented)
- Input length validation (some checks, not comprehensive)

## Missing Test Documentation

**What should be tested but isn't documented:**
- Test fixtures for common objects (user, deck, bounty, event)
- Setup/teardown procedures for database state
- Mock/stub patterns for external services
- Integration test flow (e.g., upload → generate thumbnail → verify)
- Error scenario testing (network failures, invalid data)

---

*Testing analysis: 2026-04-05*

## Recommended First Steps for Testing

1. **Add test framework:** Jest or Vitest with ~10 second startup
2. **Write integration tests first:** Focus on critical paths (auth, upload, payments)
3. **Mock external services:** Google OAuth, LNbits, Puppeteer
4. **Use test database:** Separate SQLite DB for tests, reset between runs
5. **Add error scenario tests:** Network timeouts, invalid data, missing resources
