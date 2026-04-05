# Technology Stack

**Analysis Date:** 2026-04-05

## Languages

**Primary:**
- JavaScript (Node.js) - Server-side runtime
- HTML/CSS/Vanilla JS - Frontend, no framework, no build step

## Runtime

**Environment:**
- Node.js 22+ (uses built-in `node:sqlite`)
- Chrome/Chromium - For Puppeteer headless rendering

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js 4.18.2 - Web server framework

**Image Processing:**
- Puppeteer 21.11.0 - Headless Chrome for screenshot/thumbnail generation
- Sharp 0.34.5 - Image processing and optimization

**Utilities:**
- QRCode 1.5.4 - Generate QR codes for shared content
- Unzipper 0.12.3 - Extract uploaded ZIP files
- Multer 1.4.5-lts.1 - File upload handling

**Authentication:**
- bcryptjs 3.0.3 - Password hashing
- cookie-session 2.1.1 - Session management

**Environment:**
- dotenv 17.4.0 - Load environment variables

## Key Dependencies

**Critical:**
- express - HTTP server and routing
- node:sqlite (built-in) - Relational database, persistent storage
- puppeteer - Screenshot/thumbnail generation from HTML
- bcryptjs - Secure password storage
- multer - Multipart file uploads
- sharp - Image optimization (resizing thumbnails)
- qrcode - QR code generation for deck sharing
- unzipper - ZIP extraction for batch deck uploads

## Configuration

**Environment:**
- Configuration via `.env` file (not tracked)
- Example config: `.env.example`
- Key variables:
  - `SESSION_SECRET` - Session encryption key (required in production)
  - `BASE_URL` - Public domain (enables production mode and security headers)
  - `PORT` - Server port (default: 3100)
  - `NODE_ENV` - Production/development flag
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth (optional)
  - `LNBITS_URL` - Lightning Network Bits API endpoint
  - `LNBITS_INVOICE_KEY` - LNbits invoice creation key
  - `LNBITS_ADMIN_KEY` - LNbits admin operations key
  - `LNBITS_WEBHOOK_SECRET` - Webhook signature verification

**Build:**
- No build step required - frontend is vanilla HTML/CSS/JS
- Frontend assets served from `public/` directory
- Templated HTML files: `build.html`, `index.html`, `deck.html`, `upload.html`, `project.html`, `event.html`, `profile.html`, `bounty.html`, `admin.html`, `live.html`, `vote.html`, `welcome.html`

**Styling:**
- CSS: `public/css/style.css` (120KB, no CSS framework)
- Fonts: Space Grotesk, Inter (via Google Fonts or CDN)
- Responsive design with CSS Grid/Flexbox

**JavaScript:**
- Client-side: `public/js/auth.js` - Authentication UI and notifications
- No bundler (raw ES6 modules)
- Fetch API for all client-server communication

## Database

**Technology:**
- SQLite 3 (Node.js built-in `node:sqlite` module)
- File-based: `deckpad.db` in project root
- Persists across restarts
- PRAGMA settings: `foreign_keys = OFF`

**Data Files:**
- Database: `deckpad.db` (167KB+)
- Auto-backup system: Timestamped backup files on writes
- No external database required

## Platform Requirements

**Development:**
- Node.js 22+
- Google Chrome (for Puppeteer)
- macOS/Linux/Windows
- ~500MB disk for node_modules

**Production:**
- Node.js 22+
- Chrome/Chromium runtime (for Puppeteer)
- 100MB+ free disk (database + uploads + thumbnails)
- TLS certificate (recommended via nginx/CloudFlare)
- Deployment platforms tested:
  - Railway (auto SSL, restart)
  - Fly.io (edge deployment)
  - VPS (full control)
  - Mac mini + Cloudflare Tunnel (current production setup)

## File Uploads

**Storage:**
- Local filesystem only
- Directories:
  - `uploads/` - User-uploaded HTML/ZIP files (50MB max)
  - `thumbnails/` - Auto-generated screenshots (Puppeteer output)
  - `avatars/` - User profile pictures
  - `temp/` - Temporary files during processing

**Processing Pipeline:**
1. Multer validates file type/size
2. Unzipper extracts ZIP files if needed
3. Puppeteer generates thumbnail screenshot
4. Sharp optimizes thumbnail image
5. File stored with UUID directory structure

## Image Processing

**Thumbnails:**
- Generated on deck upload via Puppeteer
- Rendered at 1024x640px
- Optimized with Sharp before storage

**Profile Avatars:**
- Uploaded by users
- Max 500KB
- Handled by Multer with custom upload folder

**Project Banners:**
- Uploaded by project creators
- Max 5MB
- Stored with project ID

---

*Stack analysis: 2026-04-05*
