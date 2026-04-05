# Codebase Concerns

**Analysis Date:** 2026-04-05

## Tech Debt

### Foreign Key Constraints Disabled

**Issue:** Database foreign key constraints are explicitly disabled at startup.

```
Line 42 (server.js): db.exec('PRAGMA foreign_keys = OFF');
```

**Files:** `server.js`

**Impact:** 
- Orphaned records can accumulate (bounty_participants referencing deleted bounties, bounty_payments for deleted bounties)
- Data integrity is not enforced at the database level
- Risk of cascading deletion issues and data inconsistency

**Fix approach:** 
Enable foreign key constraints (`PRAGMA foreign_keys = ON`) and implement proper cascade delete policies for related entities. This requires auditing existing orphaned records and cleaning them up before enabling enforcement.

---

### Missing Bounty Card Data Field in List Endpoint

**Issue:** The `/api/bounties` endpoint doesn't include the `funded_amount` field that frontend components expect.

**Files:**
- `server.js` line 1003-1011 (API endpoint query)
- `public/build.html` line 488-550 (bounty card rendering)

**Current query:**
```javascript
SELECT b.*, COALESCE(pc.cnt, 0) as participant_count
FROM bounties b
LEFT JOIN (SELECT bounty_id, COUNT(*) as cnt FROM bounty_participants GROUP BY bounty_id) pc
```

**Frontend expects:**
```javascript
const fundedAmt = Number(b.funded_amount || 0);  // Line 501 in build.html
const fundingBar = targetAmt > 0 ? `...` : '';   // Line 505-509
```

**Impact:**
- Bounty cards display "No extra sats in the pot yet" even when prize pool has been funded
- Funding percentage bar shows 0% when bounties have contributions
- Users see incorrect prize pool status

**Fix approach:**
Add `funded_amount` field to the bounty list query. The column exists in the schema (`v002_bounty_fields` migration) but isn't being selected.

---

### No Rate Limiting on Profile and Bounty Mutations

**Issue:** Profile updates, bounty creation/updates, and payment operations lack rate limiting.

**Files:** `server.js` line 1443 (TODO comment)

```javascript
// TODO: Add rate limiting to profile mutation endpoints (e.g. express-rate-limit)
```

**Vulnerable endpoints:**
- `POST /api/bounties` (line 1013) - Create bounty
- `POST /api/bounties/:id/fund` (line 1331) - Fund bounty
- `POST /api/bounties/:id/join` (line 1035) - Join bounty
- `PUT /api/users/:id` - Profile updates
- `POST /api/users/:id/avatar` - Avatar uploads

**Impact:**
- Spam creation of bounties and participations
- Rapid-fire payment invoice generation can overload LNbits
- DDoS vulnerability on write-heavy endpoints
- Potential abuse of Lightning network invoice APIs

**Fix approach:**
Implement express-rate-limit middleware with tiered limits per endpoint and per-user tracking.

---

## Known Bugs

### Empty Error Handling in Payment Polling

**Issue:** Payment verification polling catches errors silently without user notification.

**Files:** `public/bounty.html` line 750

```javascript
} catch {}  // Silent failure - no error message to user
```

**Impact:**
- Network errors during payment verification go unnoticed
- User waits 5 minutes for payment confirmation that will never arrive
- No indication that verification failed or can be retried

**Fix approach:**
Log errors and show user-friendly timeout message. Allow manual confirmation fallback for all payment types, not just non-LNbits providers.

---

### Silent Failures in Secondary Requests

**Issue:** Multiple secondary requests fail silently in bounty page and build page.

**Files:**
- `public/bounty.html` line 583 (loading decks dropdown): `} catch {}`
- `public/bounty.html` line 692 (clipboard copy): `.catch(() => {})`
- `public/build.html` line 1458 (populating event dropdown): `} catch {}`

**Impact:**
- Decks dropdown doesn't populate (users can't attach presentations)
- Event selection dropdown remains empty for admins
- Clipboard copy fails silently
- No feedback to user when requests fail

**Fix approach:**
At minimum, log errors to console and consider fallback UI states. For critical dropdowns, show error message to user.

---

### Bounty List Not Refreshing After Create/Update

**Issue:** After creating/updating a bounty, the UI calls `loadBounties()` to refresh, but there's no loading state or error feedback if the refresh fails.

**Files:**
- `public/build.html` line 1442: `loadBounties();` (after create)
- `public/build.html` line 1356: `loadBounties();` (after approve winner)
- `public/build.html` line 1364: `loadBounties();` (after mark paid)

**Impact:**
- Users see stale data after actions complete
- If list endpoint is temporarily down, user won't know
- Created bounties may not appear in list immediately

**Fix approach:**
Show loading skeleton while refreshing. Add error handling with retry option. Consider optimistic UI updates instead of full refresh.

---

## Security Considerations

### Lightning Payment Webhook Verification Missing

**Issue:** LNbits webhook handling doesn't appear to validate the webhook secret or signature.

**Files:** `server.js` line 31 (webhook secret defined but never used)

```javascript
const LNBITS_WEBHOOK_SECRET = process.env.LNBITS_WEBHOOK_SECRET || '';
```

**Risk:**
- Malicious actors can forge webhook callbacks to mark payments as confirmed
- Any endpoint can claim a payment was verified
- Fund pool manipulation and bounty winner payment fraud possible

**Current mitigation:** None visible in code

**Recommendations:**
- Validate webhook signature using LNBITS_WEBHOOK_SECRET
- Use HMAC-SHA256 for signature verification
- Add rate limiting to webhook endpoint
- Log all webhook attempts for audit trail

---

### SQL Injection via Indirect Input

**Issue:** While parameterized queries are used, user input flows through template literals in some places.

**Files:** `public/build.html` line 648-651

```javascript
const r = await fetch('/api/bounties/' + bountyId + '/fund', {
  method: 'POST',
  body: JSON.stringify({ amount_sats: amount }),
});
```

Although this particular case is safe (number type), inline URL construction could be exploited if IDs aren't validated.

**Risk:** Low (parameterized queries prevent SQL injection), but URI parameter pollution could cause issues.

**Recommendations:**
- Validate bountyId format (UUID) before using in fetch URLs
- Use URL constructor instead of string concatenation

---

### Missing CSRF Protection on State-Changing Operations

**Issue:** POST/DELETE operations lack CSRF token validation (though cookie-session is configured).

**Files:** `server.js` line 13 (cookie-session enabled but no CSRF middleware)

**Risk:**
- Cross-site request forgery possible on bounty funding, joins, approvals
- Attacker can force admin to approve winners or mark payments

**Current mitigation:** Session-based authentication only

**Recommendations:**
- Add CSRF token validation middleware (e.g., csurf)
- Validate origin/referer headers
- Add SameSite=Strict to session cookies

---

## Performance Bottlenecks

### Missing Indexes on Bounty Queries

**Issue:** Frequent queries on bounty_participants lack indexes.

**Files:** `server.js` - multiple queries:
- Line 1005-1008: Counts participants per bounty on every list request
- Line 1041: Checks if user already participating (no index on bounty_id, user_id)
- Line 1054: Fetches participants list (no index on bounty_id)

**Current query pattern:**
```javascript
SELECT bounty_id, COUNT(*) as cnt FROM bounty_participants GROUP BY bounty_id
```

**Impact:**
- Full table scans on bounty_participants for every bounty list load
- As participant count grows, list endpoint response time increases linearly
- JOIN operations become slower

**Improvement path:**
Add indexes on bounty_participants:
```sql
CREATE INDEX idx_bounty_participants_bounty_id ON bounty_participants(bounty_id);
CREATE INDEX idx_bounty_participants_user_id ON bounty_participants(user_id);
CREATE INDEX idx_bounty_participants_lookup ON bounty_participants(bounty_id, user_id);
```

---

### N+1 Query on Bounty Winner Badge Checks

**Issue:** Badge award checks query bounties multiple times per action.

**Files:** `server.js` lines 333, 382, 1119, 1129, 1393, 1397

Example:
```javascript
// Line 1119: approve winner
checkAndAwardBadges(winner_id);

// Inside checkAndAwardBadges:
const won = db.prepare('SELECT id FROM bounties WHERE winner_id = ? AND paid_out = 1').get(userId);
```

This queries for bounty count every time a winner is approved, even if user already has badges.

**Impact:**
- Extra database queries on every payment confirmation
- 2-3 queries per payment verification flow
- Becomes noticeable with high payment volume

**Improvement path:**
Cache badge state in user record or use single batch query.

---

### Full Table Scan Risk on Bounty Status Updates

**Issue:** Bounty status transitions don't use indexed lookups where possible.

**Files:** `server.js` line 2537

```javascript
const rows = db.prepare("SELECT * FROM bounties WHERE event_id = ? ORDER BY created_at DESC").all(req.params.id);
```

While event_id is used, there are no indexes on commonly filtered bounty fields:
- deadline (for checking overdue bounties)
- status (for filtering open vs claimed)
- created_at (for sorting in lists)

**Impact:**
- List queries become slower as bounty count grows
- No way to efficiently query "all open bounties"

**Improvement path:**
Add indexes:
```sql
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_deadline ON bounties(deadline);
CREATE INDEX idx_bounties_created_at ON bounties(created_at DESC);
```

---

## Fragile Areas

### Bounty Card Rendering Depends on Inconsistent Data

**Files:**
- `public/build.html` line 495-546 (bounty card rendering)

**Why fragile:**
1. Expected data fields not guaranteed in list endpoint response
   - `funded_amount` missing from query
   - `participants` array missing (only `participant_count` sent)
   - `winner_name` may be null but rendering assumes it exists

2. Type coercion relies on defensive checks:
   ```javascript
   const fundedAmt = Number(b.funded_amount || 0);           // Works but fragile
   const participantCount = Array.isArray(b.participants) ? // May fail if participants not sent
   ```

3. Rendering logic has no validation:
   ```javascript
   const deadline = b.deadline ? `<span>...</span>` : '';     // Silently hides missing data
   ```

**Safe modification path:**
1. Update `/api/bounties` endpoint to include all fields needed by card rendering
2. Add explicit type checking in card renderer
3. Show placeholder UI for missing data instead of silently hiding
4. Unit test card renderer with incomplete data

---

### Lightning Payment Verification Fallback Is Silent

**Issue:** Payment verification has three fallback modes but doesn't clearly communicate which one is active.

**Files:** `public/bounty.html` line 729-751

```javascript
if (payment.payment_hash && LNBITS_INVOICE_KEY) {
  // Mode 1: LNbits API verification
} else if (payment.verify_url) {
  // Mode 2: Custom verify URL
} else {
  // Mode 3: No verification - manual only
}
```

**Fragile because:**
- Code path depends on LNbits config being set correctly
- No telemetry to know which path is being used in production
- If fallback activates, polling stops and user sees generic message
- Manual confirm button only shows for Mode 3, confusing UX

**Safe modification path:**
1. Log which verification mode is active for each payment
2. Show clear message to user about verification method
3. Always offer manual confirm button as fallback
4. Add monitoring/alerts for verification failures

---

## Scaling Limits

### SQLite Database Scaling

**Issue:** Project uses SQLite (file-based database) which has write concurrency limitations.

**Files:** `server.js` line 41

```javascript
const db = new DatabaseSync(DB_PATH);
```

**Current capacity:**
- SQLite file size: Currently ~114-167 MB (based on backup sizes)
- Single-threaded writes
- Locking on all write operations
- No connection pooling

**Limit:** 
- As bounty/payment volume grows, SQLite write-locks become bottleneck
- Typical SQLite deployment supports ~100 concurrent writes/second max
- With LNbits webhook callbacks + polling, this is reachable

**Scaling path:**
1. Short term: Add connection pooling and write batching
2. Medium term: Move to PostgreSQL or MySQL with proper indexing
3. Separate read replicas for payment verification queries

---

### LNbits API Rate Limits

**Issue:** No queuing or batching for LNbits API calls (invoice creation, verification).

**Files:**
- `server.js` line 1340: Individual invoice creation
- `server.js` line 1380: Individual payment verification
- `server.js` line 1417: Individual LN address resolution

**Current behavior:** Each user request → direct LNbits API call

**Limit:** LNbits has rate limits (typically 100-1000 req/min depending on config)

**Scaling path:**
- Implement request queue/batch operations
- Cache LN address resolution results
- Use webhooks instead of polling for large-scale payment verification
- Monitor LNbits response times and implement backoff

---

## Dependencies at Risk

### Puppeteer Version Mismatch

**Issue:** Project uses Puppeteer (for deck thumbnail generation) but may have compatibility issues.

**Files:** `server.js` line 12, `package.json` line 16

```json
"puppeteer": "^21.11.0"
```

**Risk:**
- Puppeteer has breaking changes between major versions
- Chromium binary compatibility with Node runtime
- Memory usage for thumbnail generation on server

**Current usage:** Line 2615 (`generateThumbnail()`) - generates PNGs from HTML deck

**Impact:** If Puppeteer version becomes incompatible, deck uploads break

**Migration plan:**
- Test compatibility before upgrades
- Consider lighter alternative (sharp + SVG rendering) for simple decks
- Add graceful degradation if thumbnail generation fails

---

## Missing Critical Features

### No Bounty Deadline Enforcement

**Issue:** Bounty deadline is stored but never checked or enforced.

**Files:** `server.js` schema line 97, but no enforcement logic

**Problem:**
- Bounties with passed deadlines still show as "open"
- No automatic status transition to "overdue"
- No queries to find expired bounties
- Admin workflow unclear: do they manually close overdue bounties?

**What's missing:**
- Deadline validation in bounty list (client-side filtering works, server doesn't enforce)
- Cron job to auto-close overdue bounties
- Clear communication when bounty is past deadline

**Blocks:** Clear project lifecycle management

---

### No Bounty Payment Reconciliation

**Issue:** No way to reconcile payments received vs. recorded.

**Files:** `server.js` - no reconciliation endpoints

**Problem:**
- If webhook fails, payment confirmation is lost
- No admin dashboard showing unconfirmed payments
- No bulk verification endpoint
- No audit log of payment state changes

**What's missing:**
- `GET /api/admin/unconfirmed-payments` endpoint
- Bulk verification endpoint
- Payment audit log with timestamps
- Admin UI to manually confirm payments

**Blocks:** Admin reconciliation workflow

---

### No Bounty Submission/Completion Tracking

**Issue:** Bounties accept participants but don't track submissions or deliverables.

**Files:** `bounty_participants` table has no submission tracking

**Problem:**
- Can't see what each participant submitted
- No way to track multiple submissions
- Can't store links to demos, repos, presentations
- Admin has no structured way to evaluate entries

**What's missing:**
- `bounty_submissions` table with submission details
- Submission tracking in bounty detail page
- Admin review interface for submissions

**Blocks:** Structured bounty completion workflow

---

## Test Coverage Gaps

### Bounty Card Rendering Not Tested

**What's not tested:**
- Data field presence (missing `funded_amount`, `participants`)
- Type coercion edge cases (null values, missing fields)
- Status badge rendering for all states (open/claimed/completed)
- Deadline formatting for various date ranges
- Participant count pluralization

**Files:** `public/build.html` line 495-546

**Risk:** 
- Breaking changes not caught
- Edge cases (1 participant, 100 participants) not verified
- Regression on card UI not detected

**Priority:** Medium - user-visible feature, affects all bounty listings

---

### Payment Verification Flow Not Tested

**What's not tested:**
- Polling timeout behavior (5 minute limit)
- Fallback to manual confirmation
- Error recovery
- Multiple concurrent payment verifications
- LNbits API failure handling

**Files:** `public/bounty.html` line 719-776

**Risk:**
- Payment verification can silently fail
- Users confused about status after timeout
- No coverage for fallback flows

**Priority:** High - financial feature, user loses ability to confirm payment

---

### Bounty Lifecycle State Transitions Not Tested

**What's not tested:**
- Valid transitions (open → in_review → claimed → completed)
- Invalid transitions (claimed → open)
- Status consistency after state changes
- Winner badge award on completion
- Funded amount preservation across status changes

**Files:** `server.js` line 1113-1131 (approval/completion endpoints)

**Risk:**
- Bounties get stuck in invalid states
- Winner data lost on status change
- Funded amount wiped

**Priority:** High - core business logic, data corruption risk

---

### Missing Test for Orphaned Records

**What's not tested:**
- Deleting bounty with participants (cascading delete with FK disabled)
- Deleting bounty with payments (funded_amount references lost)
- Deleting event that contains bounties
- Cleanup of abandoned bounty_payments

**Files:** `server.js` line 1097-1101 (bounty deletion)

**Risk:**
- Orphaned bounty_participants accumulate
- Orphaned bounty_payments block future operations
- Database bloat

**Priority:** Medium - data integrity, cleanup burden

---

*Concerns audit: 2026-04-05*
