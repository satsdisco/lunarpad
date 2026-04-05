# Coding Conventions

**Analysis Date:** 2026-04-05

## Naming Patterns

**Files:**
- Lowercase filenames with hyphens for separators: `auth.js`, `upload.html`, `deck.html`
- Database file: `deckpad.db`
- Directory structure uses descriptive names: `public/`, `thumbnails/`, `avatars/`, `temp/`, `uploads/`

**Functions:**
- camelCase for regular functions: `checkAndAwardBadges()`, `cachedBadgeCheck()`, `resolveLnAddress()`, `autoForwardZap()`
- camelCase for async functions: `async function generateThumbnail()`, `async function resolveLnAddress()`
- PascalCase for database prepared statements stored in objects: NOT used; all lowercase

**Variables:**
- camelCase for local variables: `userId`, `userName`, `totalSats`, `deckDir`, `fullPath`
- SCREAMING_SNAKE_CASE for constants: `PORT`, `ROOT`, `UPLOADS_DIR`, `DB_PATH`, `ADMIN_LN_ADDRESS`, `LNBITS_INVOICE_KEY`
- Descriptive variable names in loops and queries: `userId`, `deck`, `bounty`, `event` (not `d`, `b`, `e`)
- Plural for collections: `decks`, `bounties`, `events`, `speakers`

**Types:**
- No explicit TypeScript types used; JavaScript/Node.js only
- Object keys use snake_case in database schema: `user_id`, `created_at`, `password_hash`
- JSON responses use camelCase: `{id, slug, title, votes, voted}`

## Code Style

**Formatting:**
- No linter configured (no `.eslintrc`, `.prettierrc`, or Prettier config)
- Indentation: 2 spaces (observed throughout)
- Semicolons: Used consistently
- Quote style: Single quotes preferred in most code, backticks for template literals

**Linting:**
- No linting framework detected
- No automated formatting enforced

## Import Organization

**Order:**
1. Node.js built-in modules: `require('fs')`, `require('path')`, `require('crypto')`
2. Third-party packages: `require('express')`, `require('multer')`, `require('bcryptjs')`
3. Local modules and inline requires (minimal): `const bcrypt = require('bcryptjs')`

**Pattern:**
```javascript
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
// ... more requires
```

**Path Aliases:**
- None used; relative paths with `path.join()` preferred: `path.join(ROOT, 'public')`

## Error Handling

**Patterns:**
- Try-catch blocks used selectively for critical operations (auth, payment, thumbnail generation)
- Errors logged to console with context prefix: `console.error('[auth] OAuth callback error:', err)`
- Graceful fallback on non-critical failures: `try { sharp = require('sharp'); } catch { sharp = null; }`
- Database migration errors caught and logged with message filtering: `if (!e.message?.includes('duplicate'))` to ignore expected errors
- JSON parsing wrapped in try-catch with fallback: `try { badges = JSON.parse(...) } catch { badges = [] }`
- API errors returned as JSON: `res.status(400).json({ error: 'message' })`
- Middleware errors handled with dedicated error handler at end of file (lines 3176-3184)

**Response Pattern:**
```javascript
// Validation check
if (!username || !password) return res.status(400).json({ error: 'message' });

// Success response
res.json({ ok: true });

// Error response
res.status(404).json({ error: 'Not found' });
```

## Logging

**Framework:** Plain `console` (no logger library)

**Patterns:**
- Prefixed logs with category in brackets: `[auth]`, `[migration]`, `[seed]`, `[thumb]`, `[notify]`, `[autoForward]`
- Log levels used: `console.log()` for info, `console.warn()` for warnings, `console.error()` for errors
- Minimal logging; only important events and errors logged

**Examples:**
```javascript
console.log(`[migration] Running ${m.name}...`);
console.error(`[migration] ${m.name} warning:`, e.message);
console.log(`[auth] Linked Google account to existing user: ${user.name} (${user.id})`);
console.warn(`[thumb] ${id}: ${err.message}`);
console.error('[autoForward] Failed zap ${zap.id}: ${e.message}');
```

## Comments

**When to Comment:**
- Section dividers using decorative headers: `// ─── Config ─────────────────────────────────────────────────────────────────`
- Inline explanations for non-obvious logic: `// Ignore "duplicate column" / "already exists" errors`
- Route documentation: `// GET /api/decks?search=&tags=&sort=newest&page=1&limit=12`
- Logic notes: `// Enhance with permission checks when scaling`
- Purpose statements in migrations: `// Column additions (originally untracked ALTER TABLEs)`

**JSDoc/TSDoc:**
- Not used; no JSDoc comments found in codebase
- Comments are inline and minimal

**Approach:**
- Comments explain "why" not "what": Code is readable enough to understand "what" it does
- Section headers using horizontal line pattern: `// ─── [Section] ──────────────────────────────────────`

## Function Design

**Size:** 
- Typically 10-30 lines per function
- Some helper functions are very short (5-10 lines)
- Database query helpers are stored as prepared statements in `stmts` object

**Parameters:**
- Explicit parameter passing preferred
- Destructuring used for request body extraction: `const { username, password } = req.body`
- Variadic parameters not used; fixed argument counts

**Return Values:**
- Functions that need to return early use early returns: `if (!deck) return res.status(404).json(...)`
- Middleware functions call `next()` at end of flow
- Async functions return Promises; `.catch()` used for error handling on promises

**Patterns:**
```javascript
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect('/welcome');
}

async function resolveLnAddress(address) {
  const [user, domain] = address.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning address');
  // ... rest of function
}
```

## Module Design

**Exports:**
- Express app routes defined inline with `app.get()`, `app.post()`, `app.delete()`
- Helper functions defined before use
- No `module.exports` used; single monolithic server.js

**Prepared Statements:**
- Database queries stored in object literal `stmts`: 
```javascript
const stmts = {
  insert: db.prepare(`...`),
  findUserByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  // ... more statements
};
```

**Configuration Management:**
- Constants defined at top of file under `// ─── Config` section
- Environment variables accessed via `process.env.VAR_NAME` with sensible defaults
- Paths constructed with `path.join()` and stored as constants

## Database Interaction

**Pattern:** Raw SQL with prepared statements
- No ORM used
- Prepared statements parameterized: `db.prepare('SELECT * FROM users WHERE id = ?').get(userId)`
- `.get()` for single row, `.all()` for multiple rows
- `.run()` for INSERT/UPDATE/DELETE operations
- Transaction-like batch operations: migrate by running multiple statements in a loop

**Slug Generation:**
- Custom slug functions: `toSlug()` and `uniqueSlug()`
- Slugs stored alongside UUIDs for short URLs: `/d/:slug` instead of `/deck/:uuid`

## Security Patterns

**Session Management:**
- `cookie-session` middleware with encrypted cookies
- Session TTL: 7 days
- HTTPS-only in production; development allows HTTP

**Input Validation:**
- Trim and check string presence: `if (!title.trim()) return res.status(400).json({ error: '...' })`
- UUID validation for path parameters: `if (!/^[0-9a-f-]{36}$/i.test(deckId)) return res.status(400).send('Invalid ID')`
- Directory traversal prevention: `if (!fullPath.startsWith(deckDir)) return res.status(403).send('Forbidden')`

**Authentication:**
- Google OAuth2 for primary auth
- Basic username/password support (currently disabled: "Registration is currently closed")
- Admin middleware: `requireAdmin()` checks `req.user.is_admin` flag

**Security Headers:**
- CSP, X-Frame-Options, HSTS, Permissions-Policy all configured
- See server.js lines 450-472 for header configuration

---

*Convention analysis: 2026-04-05*
