# External Integrations

**Analysis Date:** 2026-04-05

## APIs & External Services

**Google OAuth:**
- Service: Google Accounts OAuth 2.0
- What it's used for: User authentication and account linking
  - SDK: `google-oauth` (manual implementation)
  - Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (env vars)
  - Endpoints called:
    - `https://accounts.google.com/o/oauth2/v2/auth` - OAuth authorization
    - `https://oauth2.googleapis.com/token` - Token exchange
    - `https://www.googleapis.com/oauth2/v2/userinfo` - Profile fetch
  - Implementation: `server.js` lines 553-627
  - User fields stored: `google_id`, `email`, `name`, `avatar`

**Lightning Network - LNURL Protocol:**
- Service: Lightning address resolution and LNURL-pay
- What it's used for: Decode Lightning addresses to invoice generation endpoints
  - No SDK - direct HTTP calls
  - Auth: None (LNURL is stateless)
  - Protocol: LNURL-pay (LIP-17)
  - Helper functions: `resolveLnAddress()`, `fetchLnInvoice()` (lines 1194-1217 in server.js)
  - Example resolution:
    ```
    https://<domain>/.well-known/lnurlp/<username>
    → Returns callback URL for invoice generation
    ```

**LNbits Lightning Payment API:**
- Service: LNbits self-hosted Lightning node wallet
- What it's used for: Generate invoices, verify payments, pay out zaps and bounties
  - Base URL: `LNBITS_URL` env var (default: `https://21m.lol`)
  - Auth Methods:
    - `LNBITS_INVOICE_KEY` - Create invoices and verify payments
    - `LNBITS_ADMIN_KEY` - Pay invoices, admin operations
    - `LNBITS_WEBHOOK_SECRET` - Webhook signature verification
  - API Endpoints:
    - `POST /api/v1/payments` - Create invoice (lines 1237)
    - `GET /api/v1/payments/{payment_hash}` - Check payment status (line 1253)
    - `POST /api/v1/payments` (with admin key) - Pay invoice (line 1264)
  - Helper functions:
    - `lnbitsCreateInvoice(amountSats, memo, webhookUrl)` (line 1233)
    - `lnbitsCheckPayment(paymentHash)` (line 1251)
    - `lnbitsPayInvoice(bolt11)` (line 1262)

## Data Storage

**Databases:**
- SQLite 3 (local file)
  - File: `deckpad.db` (167KB+)
  - Client: Node.js built-in `node:sqlite` module
  - Connection: File-based, no network connection
  - Tables: Users, decks, projects, events, bounties, zaps, comments, votes, notifications, payments, migrations

**File Storage:**
- Local filesystem only
  - Uploads: `uploads/` directory (user-uploaded HTML/ZIP files)
  - Thumbnails: `thumbnails/` directory (Puppeteer-generated images)
  - Avatars: `avatars/` directory (user profile pictures)
  - Temp: `temp/` directory (processing workspace)

**Caching:**
- In-memory session storage via `cookie-session` (encrypted in HTTP-only cookies)
- Badge calculation caching: `cachedBadgeCheck()` function (lines 319-386)
- No external cache service (Redis, Memcached)

## Authentication & Identity

**Auth Providers:**
- **Custom username/password** (local)
  - Implementation: `server.js` lines 642-677
  - Password hashing: bcryptjs with salt
  - Routes: `POST /auth/register`, `POST /auth/login`
  - Session: `cookie-session` middleware with `SESSION_SECRET` key encryption

- **Google OAuth**
  - See "APIs & External Services" section above
  - Account linking: Automatic merge by email, or manual link when already logged in
  - Routes: `GET /auth/google`, `GET /auth/google/callback`

- **Development user switching** (localhost only)
  - Route: `GET /dev/switch/:name` (line 670)
  - Quick account switching for testing

**User Fields:**
- `id` - UUID primary key
- `google_id` - Google account linkage
- `username` - Local login handle
- `email` - Contact address
- `name` - Display name
- `avatar` - Profile picture URL
- `password_hash` - Bcrypt hash of password
- `is_admin` - Administrative privilege flag
- `lightning_address` - LNURL-pay capable address (optional)
- `bio`, `website_url`, `github_url` - Profile metadata
- `badges` - JSON array of earned badges
- `total_sats_received` - Lightning zap sum
- `created_at` - Registration timestamp

## Webhooks & Callbacks

**Incoming Webhooks:**
- **LNbits Payment Webhook**
  - Route: `POST /api/webhook/lnbits` (line 1765)
  - Trigger: LNbits sends webhook when payment is confirmed
  - Auth: `LNBITS_WEBHOOK_SECRET` in header `X-Api-Key` (line 1767)
  - Payload: `{ payment_hash, ... }`
  - Actions:
    - Updates zap status to `confirmed`
    - Updates bounty payment status to `confirmed`
    - Forwards zap sats to recipient's Lightning address if provided
    - Triggers badge checking for achievement awards
    - Sends notifications to recipients
  - Processing: Line 1765-1820 in `server.js`

**Outgoing Callbacks:**
- **LNbits Invoice Webhooks** (sent by application)
  - When creating bounty fund invoice: line 1339
    ```
    webhookUrl = BASE_URL + '/api/webhook/lnbits'
    ```
  - When creating project zap invoice: line 1586
  - When creating deck zap invoice: line 1643
  - Purpose: LNbits calls webhook when payment received, triggers instant confirmation

## Monitoring & Observability

**Error Tracking:**
- None configured
- Errors logged to console with prefixes like `[webhook]`, `[auth]`, `[error]`

**Logs:**
- Console logs (stdout) only
  - Auth events: `[auth] Created new Google user`, `[auth] Linked Google account`
  - Webhook errors: `[webhook autoForward]` error messages
  - Database migrations: Migration application log
- No persistent logging system (Sentry, LogRocket, DataDog)
- No request logging middleware (Morgan)

**Database Integrity:**
- Migrations table (`_migrations`) tracks applied schema changes
- Backup files created before major updates: `.backup-TIMESTAMP` format
- Foreign key constraints disabled: `PRAGMA foreign_keys = OFF`

## Configuration

**Required env vars:**
- `SESSION_SECRET` - Encryption key for sessions (required in production)
- `BASE_URL` - Public domain (triggers production security headers)
- `LNBITS_URL` - LNbits API endpoint (optional, default: `https://21m.lol`)
- `LNBITS_INVOICE_KEY` - Required if Lightning payment creation is enabled
- `LNBITS_ADMIN_KEY` - Required if zap forwarding is enabled
- `LNBITS_WEBHOOK_SECRET` - Recommended for webhook signature verification

**Optional env vars:**
- `PORT` - HTTP port (default: 3100)
- `NODE_ENV` - `production` flag (triggers strict cookie settings)
- `GOOGLE_CLIENT_ID` - Enable Google OAuth
- `GOOGLE_CLIENT_SECRET` - Enable Google OAuth

**Secrets location:**
- `.env` file (not tracked, example in `.env.example`)
- Environment variables passed at container/process startup
- Never committed to git

## Security Headers

**When `BASE_URL` is set (production mode):**
- `X-Content-Type-Options: nosniff` - Prevent MIME type sniffing
- `X-Frame-Options: DENY` - Disable framing attacks
- `X-XSS-Protection: 1; mode=block` - Legacy XSS protection
- `Strict-Transport-Security` - HSTS (when served over HTTPS)
- `Content-Security-Policy` - Restrict script/style sources
- `Permissions-Policy` - Disable browser APIs:
  - camera, microphone, geolocation, payment, USB, magnetometer, gyroscope, accelerometer

**Session Security:**
- HTTP-only cookies (not accessible to JavaScript)
- Secure flag enabled in production
- SameSite=Lax (CSRF protection)
- Encrypted with `SESSION_SECRET`

## Payment System

**Lightning Network Integration Points:**

1. **Bounty Funding** (line 1331)
   - User funds bounty with sats
   - LNbits invoice created with webhook URL
   - Payment confirmed via webhook → updates `bounty_payments` table

2. **Zaps** (tips on projects/decks)
   - User initiates zap (project: line 1557, deck: line 1617)
   - Recipient's Lightning address resolved via LNURL
   - Invoice generated (via LNURL callback or LNbits)
   - Payment recorded in `zaps` table
   - Confirmed via webhook or manual verification
   - Auto-forward to recipient address if `LNBITS_ADMIN_KEY` configured

3. **Bounty Payouts** (line 1407)
   - Admin creates payout invoice to winner's Lightning address
   - Invoice paid from LNbits admin wallet
   - Marked as `paid_out` when confirmed

**Payment Tables:**
- `bounty_payments` - Bounty funding and payout records
  - Fields: `id`, `bounty_id`, `user_id`, `amount_sats`, `payment_hash`, `payment_request`, `payment_type` ('fund'/'payout'), `status` ('pending'/'confirmed'), `created_at`, `confirmed_at`
- `zaps` - Lightning tips on projects/decks
  - Fields: `id`, `user_id`, `user_name`, `target_type` ('project'/'deck'), `target_id`, `amount_sats`, `payment_hash`, `payment_request`, `status`, `recipient_address`, `forward_status`, `forward_payment_hash`

**Verification Methods:**
1. **Webhook-based** (instant) - LNbits calls `/api/webhook/lnbits` when paid
2. **Polling-based** (manual) - Route `GET /api/lightning/verify/:payment_id` (line 1372)
3. **Manual confirmation** - Admin route `POST /api/lightning/confirm/:payment_id` (line 1718)

---

*Integration audit: 2026-04-05*
