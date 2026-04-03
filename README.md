# Lunar\Pad

**Build. Ship. Earn sats.**

A platform for HTML presentations, project showcases, and demo days. Upload any HTML deck, join bounties, vote on builds, and compete for sats.

→ **[lunarpad.dev](https://lunarpad.dev)**

---

## What is LunarPad?

LunarPad is a platform built for teams that build in public. It combines:

- **Presentations** — Upload any HTML deck (reveal.js, Slidev, Marp, or raw HTML). Auto-generated thumbnails, fullscreen viewer, embed codes.
- **Demo Days & Events** — Create hackathons, demo days, and workshops. Speakers sign up, audiences vote, winners take home sats.
- **Bounties** — Post bounties with sats rewards. Builders join the hunt, submit projects, and compete.
- **Projects** — Showcase what you're building. Link your repo, demo, and presentation. Get upvotes and comments.
- **Profiles** — Track your decks, projects, and contributions.

## Quick Start

```bash
git clone https://github.com/satsdisco/lunarpad.git
cd lunarpad
npm install
cp .env.example .env  # configure your secrets
npm start
```

Open `http://localhost:3100`

## Requirements

- **Node.js 22+** (uses built-in SQLite)
- **Google Chrome** (for thumbnail generation via Puppeteer)

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Node.js, Express |
| Database | SQLite (built-in `node:sqlite`) |
| Thumbnails | Puppeteer (headless Chrome) |
| Auth | Username/password (bcrypt), Google OAuth |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Fonts | Space Grotesk, Inter |

## Configuration

Create a `.env` file:

```env
SESSION_SECRET=your-random-secret-here
BASE_URL=https://yourdomain.com

# Optional: Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

## Features

### Presentations
- Upload `.html` or `.zip` files (up to 50MB)
- Auto-generated thumbnails via Puppeteer
- Sandboxed iframe viewer with fullscreen mode
- Embed codes for external sites
- Comments with upvoting

### Events
- Create demo days, hackathons, workshops, meetups
- Speaker signup with GitHub/demo links
- Live countdown timers
- Calendar view with type-colored indicators
- RSVP system
- Add to Google Calendar

### Bounties
- Post bounties with sats rewards
- Builders join the hunt
- Track participants
- Link bounties to events
- Admin management

### Projects
- Showcase with repo + demo links
- Categories and tags
- Link presentations to projects
- Upvoting and comments
- Filter by tag

### Voting
- Unified voting system across decks, speakers, projects, and comments
- One vote per user per target
- Toggle on/off

### Admin
- Create/delete events, bounties, decks
- Manage all content
- Promote users to admin

## API

<details>
<summary>View all endpoints</summary>

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Sign in |
| GET | `/auth/logout` | Sign out |
| GET | `/auth/google` | Google OAuth |
| GET | `/api/me` | Current user |

### Decks
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/decks` | List decks |
| POST | `/api/upload` | Upload deck |
| GET | `/api/decks/:id` | Get deck |
| PUT | `/api/decks/:id` | Edit deck |
| DELETE | `/api/decks/:id` | Delete deck |

### Events
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/events` | List events |
| POST | `/api/events` | Create event |
| GET | `/api/events/:id` | Get event + speakers |
| DELETE | `/api/events/:id` | Delete event |

### Bounties
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/bounties` | List bounties |
| POST | `/api/bounties` | Create bounty |
| POST | `/api/bounties/:id/join` | Join bounty |
| DELETE | `/api/bounties/:id` | Delete bounty |

### Projects
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Edit project |
| DELETE | `/api/projects/:id` | Delete project |

### Voting
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/vote` | Toggle vote |
| GET | `/api/vote/count` | Get vote count |

</details>

## Deploying

LunarPad runs anywhere Node.js runs:

| Platform | Effort | Notes |
|----------|--------|-------|
| Railway | Easy | `railway up` — auto SSL, restart |
| Fly.io | Easy | Edge deployment |
| VPS | Medium | Full control |
| Mac mini + Cloudflare Tunnel | Free | Current setup |

## License

MIT

---

Built by [satsdisco](https://satsdisco.com)
