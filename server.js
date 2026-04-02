'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const unzipper = require('unzipper');
const { DatabaseSync } = require('node:sqlite');
const puppeteer = require('puppeteer');
const cookieSession = require('cookie-session');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = 3100;
const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const THUMBNAILS_DIR = path.join(ROOT, 'thumbnails');
const TEMP_DIR = path.join(ROOT, 'temp');
const DB_PATH = path.join(ROOT, 'deckpad.db');

for (const dir of [UPLOADS_DIR, THUMBNAILS_DIR, TEMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ─── Database ────────────────────────────────────────────────────────────────

// DB persists across restarts — schema uses CREATE TABLE IF NOT EXISTS

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    google_id  TEXT UNIQUE,
    email      TEXT,
    name       TEXT,
    avatar     TEXT,
    is_admin   INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS votes (
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    voter_ip    TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (target_type, target_id, voter_ip)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    deck_id     TEXT NOT NULL,
    user_id     TEXT,
    author_name TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deck_id) REFERENCES decks(id)
  );

  CREATE TABLE IF NOT EXISTS decks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    author      TEXT DEFAULT 'Anonymous',
    description TEXT,
    tags        TEXT,
    filename    TEXT,
    entry_point TEXT,
    views       INTEGER DEFAULT 0,
    thumbnail   TEXT,
    github_url  TEXT,
    demo_url    TEXT,
    uploaded_by TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bounties (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    sats_amount INTEGER DEFAULT 0,
    deadline    TEXT,
    status      TEXT DEFAULT 'open',
    tags        TEXT,
    event_id    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bounty_participants (
    id          TEXT PRIMARY KEY,
    bounty_id   TEXT NOT NULL,
    user_id     TEXT,
    user_name   TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bounty_id) REFERENCES bounties(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    event_type   TEXT DEFAULT 'demo-day',
    date         TEXT NOT NULL,
    time         TEXT,
    location     TEXT,
    virtual_link TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS speakers (
    id            TEXT PRIMARY KEY,
    event_id      TEXT NOT NULL,
    name          TEXT NOT NULL,
    project_title TEXT NOT NULL,
    description   TEXT,
    duration      INTEGER DEFAULT 10,
    github_url    TEXT,
    demo_url      TEXT,
    deck_id       TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id)
  );

  CREATE TABLE IF NOT EXISTS rsvps (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    email      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    builder     TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'building',
    tags        TEXT,
    category    TEXT,
    bounty_id   TEXT,
    user_id     TEXT,
    repo_url    TEXT,
    demo_url    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const stmts = {
  insert: db.prepare(`
    INSERT INTO decks (id, title, author, description, tags, filename, entry_point, github_url, demo_url, uploaded_by)
    VALUES (@id, @title, @author, @description, @tags, @filename, @entry_point, @github_url, @demo_url, @uploaded_by)
  `),
  findUserByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  insertUser:         db.prepare('INSERT INTO users (id, google_id, email, name, avatar) VALUES (?, ?, ?, ?, ?)'),
  getUserById:        db.prepare('SELECT * FROM users WHERE id = ?'),
  getById:       db.prepare('SELECT * FROM decks WHERE id = ?'),
  setThumbnail:  db.prepare('UPDATE decks SET thumbnail = ? WHERE id = ?'),
  incrementView: db.prepare('UPDATE decks SET views = views + 1 WHERE id = ?'),
  count:         db.prepare('SELECT COUNT(*) as c FROM decks'),
  allTags:       db.prepare("SELECT tags FROM decks WHERE tags IS NOT NULL AND tags != ''"),
  deleteDeck:    db.prepare('DELETE FROM decks WHERE id = ?'),
  addVote:       db.prepare('INSERT OR IGNORE INTO votes (target_type, target_id, voter_ip) VALUES (?, ?, ?)'),
  removeVote:    db.prepare('DELETE FROM votes WHERE target_type = ? AND target_id = ? AND voter_ip = ?'),
  getVoteCount:  db.prepare('SELECT COUNT(*) as c FROM votes WHERE target_type = ? AND target_id = ?'),
  hasVoted:      db.prepare('SELECT 1 FROM votes WHERE target_type = ? AND target_id = ? AND voter_ip = ?'),
  deleteVotes:   db.prepare('DELETE FROM votes WHERE target_type = ? AND target_id = ?'),
};

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: 'deckpad_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 30 * 24 * 60 * 60 * 1000,
}));

app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    req.user = stmts.getUserById.get(req.session.userId);
  }
  next();
});

// Static files (index: false so auth wall handles /)
app.use(express.static(path.join(ROOT, 'public'), { index: false }));
app.use('/thumbnails', express.static(THUMBNAILS_DIR));

// ─── Presentation file serving (sandboxed) ───────────────────────────────────

app.use('/presentations/:id', (req, res, next) => {
  const deckId = req.params.id;
  // Validate ID is a UUID-shaped string to prevent traversal at path level
  if (!/^[0-9a-f-]{36}$/i.test(deckId)) return res.status(400).send('Invalid ID');

  const deckDir = path.resolve(UPLOADS_DIR, deckId);
  const reqPath = req.path === '/' ? '/index.html' : req.path;
  const fullPath = path.resolve(deckDir, '.' + reqPath);

  // Ensure resolved path is within the deck's directory
  if (!fullPath.startsWith(deckDir + path.sep) && fullPath !== deckDir) {
    return res.status(403).send('Forbidden');
  }

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; " +
    "frame-ancestors 'self';"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');

  express.static(deckDir)(req, res, next);
});

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  (process.env.BASE_URL || `http://localhost:${PORT}`) + '/auth/google/callback',
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'consent',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  (process.env.BASE_URL || `http://localhost:${PORT}`) + '/auth/google/callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    const profile = await userRes.json();

    // Find or create user
    let user = stmts.findUserByGoogleId.get(profile.id);
    if (!user) {
      const id = crypto.randomUUID();
      stmts.insertUser.run(id, profile.id, profile.email || null, profile.name || null, profile.picture || null);
      user = stmts.getUserById.get(id);
    }

    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error('[auth] OAuth callback error:', err.message);
    res.redirect('/');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  if (req.user) {
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar, is_admin: !!req.user.is_admin } });
  } else {
    res.json({ user: null });
  }
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  return next(); // DEV: auth disabled
//DEV   if (req.user) return next();
//DEV   if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
//DEV   res.redirect('/welcome');
}


function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  res.status(403).json({ error: "Admin access required" });
}

// Promote user to admin by email
app.post("/api/admin/promote", function(req, res) {
  var email = req.body.email;
  if (!email) return res.status(400).json({ error: "email required" });
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run(email);
  res.json({ ok: true });
});

// ─── Page routes ─────────────────────────────────────────────────────────────

app.get('/welcome', (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(ROOT, 'public', 'welcome.html'));
});

app.get('/',         requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/upload',   requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'upload.html')));
app.get('/deck/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'deck.html')));
app.get('/build',    requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'build.html')));
app.get('/event/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'event.html')));
app.get('/project/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'project.html')));
app.get('/profile', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
app.get('/profile/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
app.get('/vote',     requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'vote.html')));
app.get('/admin',    requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

// ─── Upload ──────────────────────────────────────────────────────────────────

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.html', '.htm', '.zip'].includes(ext)) cb(null, true);
    else cb(new Error('Only .html, .htm, or .zip files are accepted'));
  },
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { title = '', author = 'Anonymous', description = '', tags = '', github_url = '', demo_url = '' } = req.body;
  if (!title.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Title is required' });
  }

  const id = crypto.randomUUID();
  const deckDir = path.join(UPLOADS_DIR, id);
  fs.mkdirSync(deckDir, { recursive: true });

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let entryPoint = 'index.html';

    if (ext === '.zip') {
      await fs.createReadStream(req.file.path)
        .pipe(unzipper.Extract({ path: deckDir }))
        .promise();
      // Keep original zip for download
      fs.copyFileSync(req.file.path, path.join(deckDir, '_original.zip'));
      entryPoint = detectEntryPoint(deckDir) || 'index.html';
    } else {
      fs.copyFileSync(req.file.path, path.join(deckDir, 'index.html'));
      entryPoint = 'index.html';
    }

    fs.unlinkSync(req.file.path);

    stmts.insert.run({
      id,
      title: title.trim(),
      author: author.trim() || 'Anonymous',
      description: description.trim(),
      tags: tags.trim(),
      filename: req.file.originalname,
      entry_point: entryPoint,
      github_url: github_url.trim() || null,
      demo_url: demo_url.trim() || null,
      uploaded_by: req.user ? req.user.id : null,
    });

    // Async thumbnail — don't block the response
    generateThumbnail(id, entryPoint).catch(err => {
      console.warn(`[thumb] ${id}: ${err.message}`);
    });

    res.json({ id, title: title.trim() });
  } catch (err) {
    console.error('Upload error:', err);
    fs.rmSync(deckDir, { recursive: true, force: true });
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ─── API routes ──────────────────────────────────────────────────────────────

// GET /api/decks?search=&tags=&sort=newest&page=1&limit=12
app.get('/api/decks', requireAuth, (req, res) => {
  const search = (req.query.search || '').trim();
  const tagsFilter = (req.query.tags || '').trim();
  const sort = req.query.sort || 'newest';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(title LIKE ? OR author LIKE ? OR description LIKE ? OR tags LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  if (tagsFilter) {
    for (const tag of tagsFilter.split(',').map(t => t.trim()).filter(Boolean)) {
      conditions.push('(tags LIKE ? OR tags LIKE ? OR tags LIKE ? OR tags = ?)');
      params.push(`%,${tag},%`, `${tag},%`, `%,${tag}`, tag);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    views:  'views DESC',
    votes:  'votes DESC',
  };
  const order = orderMap[sort] || 'created_at DESC';

  const total = db.prepare(`SELECT COUNT(*) as c FROM decks ${where}`).get(...params).c;
  const decks  = db.prepare(`SELECT d.*, COALESCE(v.vote_count, 0) as votes FROM decks d LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'deck' GROUP BY target_id) v ON d.id = v.target_id ${where ? where.replace(/\btitle\b/g, 'd.title').replace(/\bauthor\b/g, 'd.author').replace(/\bdescription\b/g, 'd.description').replace(/\btags\b/g, 'd.tags') : ''} ORDER BY ${order.replace(/\b(created_at|views)\b/g, 'd.$1')} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  res.json({ decks, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

// GET /api/decks/tags — all unique tags for filter chips
app.get('/api/tags', requireAuth, (req, res) => {
  const rows = stmts.allTags.all();
  const tagSet = new Set();
  for (const row of rows) {
    row.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
  }
  res.json([...tagSet].sort());
});

// GET /api/decks/:id
app.get('/api/decks/:id', (req, res) => {
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  res.json(deck);
});

// POST /api/decks/:id/view
app.post('/api/decks/:id/view', (req, res) => {
  stmts.incrementView.run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/decks/:id
app.delete('/api/decks/:id', (req, res) => {
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });

  // Remove files
  const deckDir = path.join(UPLOADS_DIR, deck.id);
  fs.rmSync(deckDir, { recursive: true, force: true });

  // Remove thumbnail
  if (deck.thumbnail) {
    const thumbPath = path.join(THUMBNAILS_DIR, deck.thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }

  // Remove votes and deck record
  stmts.deleteVotes.run('deck', deck.id);
  stmts.deleteDeck.run(deck.id);
  res.json({ ok: true });
});

// GET /api/decks/:id/votes (kept for deck.html compatibility)
app.get('/api/decks/:id/votes', (req, res) => {
  const voter = req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const count = stmts.getVoteCount.get('deck', req.params.id).c;
  const voted = !!stmts.hasVoted.get('deck', req.params.id, voter);
  res.json({ votes: count, voted });
});

// GET /api/decks/:id/download
app.get('/api/decks/:id/download', (req, res) => {
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });

  const deckDir = path.join(UPLOADS_DIR, deck.id);
  const zipPath = path.join(deckDir, '_original.zip');
  const htmlPath = path.join(deckDir, deck.entry_point);

  if (fs.existsSync(zipPath)) {
    res.download(zipPath, deck.filename || 'presentation.zip');
  } else if (fs.existsSync(htmlPath)) {
    res.download(htmlPath, deck.filename || 'presentation.html');
  } else {
    res.status(404).json({ error: 'File not found on disk' });
  }
});

// ─── Bounties API ────────────────────────────────────────────────────────────

app.get('/api/bounties', (req, res) => {
  const rows = db.prepare('SELECT * FROM bounties ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/bounties', requireAuth, (req, res) => {
  const { title, description, sats_amount, sats, deadline, status, tags, event_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO bounties (id, title, description, sats_amount, deadline, status, tags, event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title.trim(), description || null,
    parseInt(sats_amount || sats) || 0, deadline || null,
    status || 'open', Array.isArray(tags) ? tags.join(',') : (tags || null),
    event_id || null
  );
  res.json({ id });
});

app.get('/api/bounties/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.participants = db.prepare('SELECT id, user_name, created_at FROM bounty_participants WHERE bounty_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(row);
});

// Join a bounty
app.post('/api/bounties/:id/join', requireAuth, (req, res) => {
  const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Not found' });
  const userId = req.user?.id || null;
  const userName = req.user?.name || req.body.name || 'Anonymous';
  // Check if already joined
  const existing = db.prepare('SELECT id FROM bounty_participants WHERE bounty_id = ? AND (user_id = ? OR user_name = ?)').get(req.params.id, userId, userName);
  if (existing) return res.status(409).json({ error: 'Already participating' });
  const id = require('crypto').randomUUID();
  db.prepare('INSERT INTO bounty_participants (id, bounty_id, user_id, user_name) VALUES (?, ?, ?, ?)').run(id, req.params.id, userId, userName);
  const participants = db.prepare('SELECT id, user_name, created_at FROM bounty_participants WHERE bounty_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ ok: true, participants });
});

// Leave a bounty
app.delete('/api/bounties/:id/leave', requireAuth, (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Login required' });
  db.prepare('DELETE FROM bounty_participants WHERE bounty_id = ? AND user_id = ?').run(req.params.id, userId);
  const participants = db.prepare('SELECT id, user_name, created_at FROM bounty_participants WHERE bounty_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ ok: true, participants });
});

// ─── Events API ───────────────────────────────────────────────────────────────

app.get('/api/events', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT *, event_type as type FROM events ORDER BY date ASC, time ASC").all();
  for (const ev of rows) {
    ev.speakers = db.prepare(`
      SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
      FROM speakers s
      LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
      WHERE s.event_id = ?
      ORDER BY votes DESC, s.created_at ASC
    `).all(ev.id);
  }
  res.json(rows);
});

app.post('/api/events', requireAuth, (req, res) => {
  const { name, description, event_type, date, time, location, virtual_link } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!date) return res.status(400).json({ error: 'date required' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location, virtual_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name.trim(), description || null,
    event_type || 'demo-day', date, time || null,
    location || null, virtual_link || null
  );
  res.json({ id });
});

app.get('/api/events/:id', (req, res) => {
  const event = db.prepare('SELECT *, event_type as type FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const speakers = db.prepare(`
    SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
    FROM speakers s
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
    WHERE s.event_id = ?
    ORDER BY votes DESC, s.created_at ASC
  `).all(req.params.id);
  res.json({ ...event, speakers });
});

// ─── Speakers API ─────────────────────────────────────────────────────────────

app.get('/api/speakers', (req, res) => {
  const eventId = req.query.event;
  const rows = eventId
    ? db.prepare(`
        SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
        FROM speakers s
        LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
        WHERE s.event_id = ?
        ORDER BY votes DESC, s.created_at ASC
      `).all(eventId)
    : db.prepare(`
        SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
        FROM speakers s
        LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
        ORDER BY votes DESC, s.created_at ASC
      `).all();
  res.json(rows);
});

app.post('/api/speakers', requireAuth, (req, res) => {
  const { event_id, eventId, name, project_title, project, description, duration, github_url, demo_url, deck_id } = req.body;
  const eid = event_id || eventId;
  const ptitle = project_title || project;
  if (!eid || !name || !ptitle) return res.status(400).json({ error: 'event_id, name, project_title required' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eid);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO speakers (id, event_id, name, project_title, description, duration, github_url, demo_url, deck_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, eid, name.trim(), ptitle.trim(),
    description || null, parseInt(duration) || 10,
    github_url || null, demo_url || null, deck_id || null
  );
  res.json({ id });
});

app.get('/api/events/:id/speakers', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
    FROM speakers s
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
    WHERE s.event_id = ?
    ORDER BY votes DESC, s.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

// ─── RSVPs API ────────────────────────────────────────────────────────────────

app.post('/api/events/:id/rsvp', (req, res) => {
  const { name, email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO rsvps (id, event_id, name, email) VALUES (?, ?, ?, ?)').run(
    id, req.params.id, name.trim(), email || null
  );
  res.json({ id });
});

app.get('/api/events/:id/rsvps', (req, res) => {
  const rows = db.prepare('SELECT * FROM rsvps WHERE event_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(rows);
});

// ─── Projects API ─────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, COALESCE(v.vote_count, 0) as votes, b.title as bounty_title
    FROM projects p
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'project' GROUP BY target_id) v ON p.id = v.target_id
    LEFT JOIN bounties b ON p.bounty_id = b.id
    ORDER BY votes DESC, p.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, builder, description, status, tags, category, bounty_id, repo_url, repo, demo_url, demo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!builder || !builder.trim()) return res.status(400).json({ error: 'builder required' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO projects (id, name, builder, description, status, tags, category, bounty_id, user_id, repo_url, demo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name.trim(), builder.trim(), description || null,
    status || 'building',
    Array.isArray(tags) ? tags.join(',') : (tags || null),
    category || null, bounty_id || null, req.user?.id || null,
    repo_url || repo || null, demo_url || demo || null
  );
  res.json({ id });
});

// GET /api/projects/:id — single project with bounty info
app.get('/api/projects/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, COALESCE(v.vote_count, 0) as votes, b.title as bounty_title
    FROM projects p
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'project' GROUP BY target_id) v ON p.id = v.target_id
    LEFT JOIN bounties b ON p.bounty_id = b.id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// GET /api/projects/:id/comments
app.get('/api/projects/:id/comments', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const voterId = req.user?.id || ip;
  const rows = db.prepare(`
    SELECT c.*, COALESCE(v.vote_count, 0) as votes,
      CASE WHEN uv.voter_ip IS NOT NULL THEN 1 ELSE 0 END as voted
    FROM comments c
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'comment' GROUP BY target_id) v ON c.id = v.target_id
    LEFT JOIN votes uv ON uv.target_type = 'comment' AND uv.target_id = c.id AND uv.voter_ip = ?
    WHERE c.deck_id = ?
    ORDER BY c.created_at DESC
  `).all(voterId, req.params.id);
  res.json(rows);
});

// POST /api/projects/:id/comments
app.post('/api/projects/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const id = crypto.randomUUID();
  const authorName = req.user?.name || 'Anonymous';
  db.prepare('INSERT INTO comments (id, deck_id, user_id, author_name, content) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.id, req.user?.id || null, authorName, content.trim()
  );
  res.json({ id });
});

// ─── User Profile API ─────────────────────────────────────────────────────────

app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT id, name, email, avatar, is_admin, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const deckCount = db.prepare('SELECT COUNT(*) as c FROM decks WHERE uploaded_by = ?').get(req.params.id).c;
  const projectCount = db.prepare("SELECT COUNT(*) as c FROM projects WHERE user_id = ? OR builder = ?").get(req.params.id, user.name).c;
  res.json({ ...user, deck_count: deckCount, project_count: projectCount });
});

app.get('/api/users/:id/decks', (req, res) => {
  const rows = db.prepare('SELECT * FROM decks WHERE uploaded_by = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

app.get('/api/users/:id/projects', (req, res) => {
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.json([]);
  const rows = db.prepare(`
    SELECT p.*, COALESCE(v.vote_count, 0) as votes, b.title as bounty_title
    FROM projects p
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'project' GROUP BY target_id) v ON p.id = v.target_id
    LEFT JOIN bounties b ON p.bounty_id = b.id
    WHERE p.user_id = ? OR p.builder = ?
    ORDER BY p.created_at DESC
  `).all(req.params.id, user.name);
  res.json(rows);
});

// ─── Unified Vote API ─────────────────────────────────────────────────────────

// POST /api/vote — body: { type: 'deck'|'speaker'|'project'|'comment', id }
app.post('/api/vote', requireAuth, (req, res) => {
  const { type, id } = req.body;
  if (!['deck', 'speaker', 'project', 'comment'].includes(type) || !id) {
    return res.status(400).json({ error: 'type (deck|speaker|project|comment) and id required' });
  }
  const voter = req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const existing = stmts.hasVoted.get(type, id, voter);
  if (existing) {
    stmts.removeVote.run(type, id, voter);
  } else {
    stmts.addVote.run(type, id, voter);
  }
  const count = stmts.getVoteCount.get(type, id).c;
  res.json({ votes: count, voted: !existing });
});

// GET /api/vote/count?type=X&id=Y
app.get('/api/vote/count', (req, res) => {
  const { type, id } = req.query;
  if (!['deck', 'speaker', 'project', 'comment'].includes(type) || !id) {
    return res.status(400).json({ error: 'type and id required' });
  }
  const voter = req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const count = stmts.getVoteCount.get(type, id).c;
  const voted = !!stmts.hasVoted.get(type, id, voter);
  res.json({ votes: count, voted });
});

// GET /api/vote/check?type=X&ids=id1,id2,id3
app.get('/api/vote/check', (req, res) => {
  const { type, ids } = req.query;
  if (!['deck', 'speaker', 'project', 'comment'].includes(type) || !ids) {
    return res.status(400).json({ error: 'type and ids required' });
  }
  const voter = req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const idList = ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
  const result = {};
  for (const id of idList) {
    result[id] = {
      votes: stmts.getVoteCount.get(type, id).c,
      voted: !!stmts.hasVoted.get(type, id, voter),
    };
  }
  res.json(result);
});

// ─── Comments API ─────────────────────────────────────────────────────────────

// GET /api/decks/:id/comments — list comments (newest first) with vote counts
app.get('/api/decks/:id/comments', (req, res) => {
  const voter = req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const comments = db.prepare(`
    SELECT c.*, COALESCE(v.vote_count, 0) as votes
    FROM comments c
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'comment' GROUP BY target_id) v ON c.id = v.target_id
    WHERE c.deck_id = ?
    ORDER BY c.created_at DESC
  `).all(req.params.id);
  // Attach per-user voted status
  for (const c of comments) {
    c.voted = !!stmts.hasVoted.get('comment', c.id, voter);
  }
  res.json(comments);
});

// POST /api/decks/:id/comments — add comment (requires auth)
app.post('/api/decks/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO comments (id, deck_id, user_id, author_name, content) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.id, req.user.id, req.user.name || req.user.email || 'Anonymous', content.trim()
  );
  res.json({ id, author_name: req.user.name || req.user.email || 'Anonymous', content: content.trim(), votes: 0, voted: false, created_at: new Date().toISOString() });
});

// GET /api/events/:id/bounties
app.get('/api/events/:id/bounties', (req, res) => {
  const rows = db.prepare("SELECT * FROM bounties WHERE event_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json(rows);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectEntryPoint(dir, depth = 0) {
  if (depth > 4) return null;

  for (const name of ['index.html', 'index.htm', 'slides.html', 'presentation.html', 'main.html']) {
    if (fs.existsSync(path.join(dir, name))) return name;
  }

  // BFS through subdirectories
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && /\.(html|htm)$/i.test(e.name)) {
      return path.relative(dir, path.join(dir, e.name));
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      const found = detectEntryPoint(path.join(dir, e.name), depth + 1);
      if (found) return path.join(e.name, found);
    }
  }
  return null;
}

async function generateThumbnail(deckId, entryPoint) {
  // Try system Chrome first, then fall back to Puppeteer's bundled Chromium
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const execPath = chromePaths.find(p => fs.existsSync(p));
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (execPath) launchOpts.executablePath = execPath;
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const url = `http://localhost:${PORT}/presentations/${deckId}/${entryPoint}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    // Let animations settle
    await new Promise(r => setTimeout(r, 800));
    const out = path.join(THUMBNAILS_DIR, `${deckId}.webp`);
    await page.screenshot({ path: out, type: 'webp', quality: 85 });
    stmts.setThumbnail.run(`${deckId}.webp`, deckId);
    console.log(`[thumb] generated for ${deckId}`);
  } finally {
    await browser.close();
  }
}

// ─── Seed presentations ──────────────────────────────────────────────────────

const SEED_WELCOME = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to DeckPad</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--gold:#f5c518;--bg:#080808}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);color:#f0f0f0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.deck{width:100%;height:100%;position:relative}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
  align-items:center;padding:64px;text-align:center;opacity:0;
  transition:opacity .35s ease;pointer-events:none}
.slide.active{opacity:1;pointer-events:auto}

/* Slide 1 */
.s1{background:radial-gradient(ellipse at 50% 40%,#1c1400 0%,#080808 65%)}
.s1 .logo-mark{font-size:72px;font-weight:900;color:var(--gold);letter-spacing:-2px;line-height:1}
.s1 .tagline{margin-top:20px;font-size:22px;color:#999;font-weight:300;max-width:560px;line-height:1.5}
.s1 .pill{margin-top:36px;display:inline-block;border:1px solid rgba(245,197,24,.35);
  color:var(--gold);background:rgba(245,197,24,.08);padding:8px 22px;border-radius:100px;
  font-size:13px;letter-spacing:.05em;font-weight:500}

/* Slide 2 */
.s2{background:linear-gradient(160deg,#060606,#0a0f0a)}
.slide-title{font-size:44px;font-weight:800;line-height:1.15;margin-bottom:44px}
.slide-title em{color:var(--gold);font-style:normal}
.cards{display:flex;gap:24px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
  border-radius:14px;padding:28px 24px;width:190px;text-align:center}
.card .icon{font-size:32px;margin-bottom:14px}
.card h3{font-size:16px;font-weight:700;margin-bottom:8px}
.card p{font-size:13px;color:#888;line-height:1.5}

/* Slide 3 */
.s3{background:#080808}
.fw-grid{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:32px;max-width:700px}
.fw-pill{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
  border-radius:8px;padding:9px 18px;font-size:15px;font-weight:500;color:#ccc}
.sub{font-size:17px;color:#777;margin-top:8px}

/* Slide 4 */
.s4{background:radial-gradient(ellipse at 50% 55%,#1c1400 0%,#080808 65%)}
.cta{margin-top:40px;background:var(--gold);color:#000;padding:15px 38px;
  border-radius:100px;font-size:17px;font-weight:700;text-decoration:none;
  display:inline-block;transition:transform .15s,box-shadow .15s}
.cta:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(245,197,24,.35)}

/* Nav */
.dots{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:9px}
.dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.18);cursor:pointer;
  transition:background .2s,width .2s}
.dot.on{width:22px;border-radius:4px;background:var(--gold)}
.hint{position:absolute;bottom:26px;right:36px;font-size:11px;color:#444;letter-spacing:.04em}
</style>
</head>
<body>
<div class="deck" id="deck">

  <div class="slide s1 active">
    <div class="logo-mark">🎭 DeckPad</div>
    <div class="tagline">Your stage for HTML presentations.<br>Upload, share, and present anything built for the web.</div>
    <div class="pill">✦ Built for the Open Web</div>
  </div>

  <div class="slide s2">
    <div class="slide-title">One place for <em>all</em> your HTML decks</div>
    <div class="cards">
      <div class="card"><div class="icon">⬆️</div><h3>Upload</h3><p>Drop .html or .zip, up to 50MB</p></div>
      <div class="card"><div class="icon">🖥️</div><h3>Present</h3><p>Fullscreen sandboxed viewer</p></div>
      <div class="card"><div class="icon">🔍</div><h3>Discover</h3><p>Search, filter, and browse decks</p></div>
    </div>
  </div>

  <div class="slide s3">
    <div class="slide-title">Any framework. <em>Any style.</em></div>
    <div class="sub">DeckPad hosts them all — no conversion needed</div>
    <div class="fw-grid">
      <div class="fw-pill">Reveal.js</div>
      <div class="fw-pill">Slidev</div>
      <div class="fw-pill">Marp</div>
      <div class="fw-pill">Impress.js</div>
      <div class="fw-pill">Shower</div>
      <div class="fw-pill">DZSlides</div>
      <div class="fw-pill">Bespoke.js</div>
      <div class="fw-pill">Custom HTML</div>
    </div>
  </div>

  <div class="slide s4">
    <div class="slide-title">Ready to <em>take the stage?</em></div>
    <div class="sub">Upload your first presentation in seconds</div>
    <a href="/upload" class="cta">Upload Your Deck →</a>
  </div>

  <div class="dots" id="dots"></div>
  <div class="hint">← → to navigate</div>
</div>
<script>
  const slides = [...document.querySelectorAll('.slide')];
  const dotsEl = document.getElementById('dots');
  let cur = 0;

  slides.forEach((_,i)=>{
    const d = document.createElement('div');
    d.className = 'dot' + (i===0?' on':'');
    d.onclick = ()=>go(i);
    dotsEl.appendChild(d);
  });

  function go(n){
    n = Math.max(0, Math.min(n, slides.length-1));
    if(n===cur) return;
    slides[cur].classList.remove('active');
    cur=n;
    slides[cur].classList.add('active');
    [...dotsEl.children].forEach((d,i)=>d.classList.toggle('on',i===cur));
  }

  document.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key===' ') go(cur+1);
    if(e.key==='ArrowLeft') go(cur-1);
  });
  document.getElementById('deck').addEventListener('click',e=>{
    if(e.target.closest('.dot')||e.target.closest('a')) return;
    e.clientX > window.innerWidth/2 ? go(cur+1) : go(cur-1);
  });
</script>
</body>
</html>`;

const SEED_OPENWEB = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Building for the Open Web</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.deck{width:100%;height:100%;position:relative;background:#0d1117}
.slide{position:absolute;inset:0;opacity:0;transition:opacity .4s ease;pointer-events:none;
  display:flex;flex-direction:column;justify-content:center;padding:80px}
.slide.active{opacity:1;pointer-events:auto}

:root{--blue:#4f9eff;--teal:#00e5c3;--dark:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e}

.s1{background:linear-gradient(135deg,#0d1117 0%,#0a1628 60%,#091525 100%)}
.s1 .eyebrow{font-size:13px;font-weight:600;color:var(--teal);letter-spacing:.12em;text-transform:uppercase;margin-bottom:24px}
.s1 h1{font-size:64px;font-weight:900;color:var(--text);line-height:1.05;max-width:800px}
.s1 h1 span{
  background:linear-gradient(90deg,var(--blue),var(--teal));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.s1 .meta{margin-top:40px;font-size:15px;color:var(--muted)}

.s2,.s3,.s4{background:var(--dark)}
.s2{align-items:flex-start}
.big-stat{font-size:110px;font-weight:900;line-height:1;
  background:linear-gradient(90deg,var(--blue),var(--teal));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.stat-label{font-size:28px;color:var(--text);font-weight:700;margin-top:8px}
.stat-sub{font-size:17px;color:var(--muted);margin-top:12px;max-width:520px;line-height:1.6}

.s3{align-items:flex-start}
.s3 h2{font-size:48px;font-weight:800;color:var(--text);margin-bottom:44px;line-height:1.1}
.s3 h2 span{color:var(--blue)}
.code-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:24px 28px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:14px;
  line-height:1.7;color:#e6edf3;max-width:640px}
.code-block .kw{color:#ff7b72}
.code-block .str{color:#a5d6ff}
.code-block .cm{color:var(--muted)}

.s4 h2{font-size:52px;font-weight:800;color:var(--text);margin-bottom:44px;line-height:1.1}
.s4 h2 em{color:var(--teal);font-style:normal}
.pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:800px}
.pillar{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}
.pillar .num{font-size:32px;font-weight:900;color:var(--blue);line-height:1}
.pillar h3{font-size:16px;font-weight:700;color:var(--text);margin:8px 0 6px}
.pillar p{font-size:13px;color:var(--muted);line-height:1.5}

.dots{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:8px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--border);cursor:pointer;transition:all .2s}
.dot.on{width:20px;border-radius:4px;background:var(--blue)}
.hint{position:absolute;bottom:26px;right:36px;font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="deck" id="deck">

  <div class="slide s1 active">
    <div class="eyebrow">Web Platform · 2024</div>
    <h1>Building for the <span>Open Web</span></h1>
    <div class="meta">A talk about HTML, standards, and why the web platform wins — eventually.</div>
  </div>

  <div class="slide s2">
    <div class="big-stat">96%</div>
    <div class="stat-label">of the world's websites run on HTML</div>
    <div class="stat-sub">It's the most widely deployed document format in human history. And it keeps getting more powerful.</div>
  </div>

  <div class="slide s3">
    <h2>HTML is <span>more capable</span><br>than you think</h2>
    <div class="code-block">
      <span class="cm">&lt;!-- Native dialog, no JS needed --&gt;</span><br>
      <span class="kw">&lt;dialog</span> id=<span class="str">"modal"</span><span class="kw">&gt;</span><br>
      &nbsp;&nbsp;<span class="kw">&lt;h2&gt;</span>It just works<span class="kw">&lt;/h2&gt;</span><br>
      &nbsp;&nbsp;<span class="kw">&lt;form</span> method=<span class="str">"dialog"</span><span class="kw">&gt;</span><br>
      &nbsp;&nbsp;&nbsp;&nbsp;<span class="kw">&lt;button&gt;</span>Close<span class="kw">&lt;/button&gt;</span><br>
      &nbsp;&nbsp;<span class="kw">&lt;/form&gt;</span><br>
      <span class="kw">&lt;/dialog&gt;</span>
    </div>
  </div>

  <div class="slide s4">
    <h2>The three <em>pillars</em></h2>
    <div class="pillars">
      <div class="pillar"><div class="num">01</div><h3>Interoperability</h3><p>Write once, runs in every browser, on every device, forever.</p></div>
      <div class="pillar"><div class="num">02</div><h3>Accessibility</h3><p>Semantic HTML gives screen readers and assistive tech a fighting chance.</p></div>
      <div class="pillar"><div class="num">03</div><h3>Longevity</h3><p>HTML from 1994 still renders. No other platform can claim that.</p></div>
    </div>
  </div>

  <div class="dots" id="dots"></div>
  <div class="hint">← → to navigate</div>
</div>
<script>
  const slides=[...document.querySelectorAll('.slide')];
  const dotsEl=document.getElementById('dots');
  let cur=0;
  slides.forEach((_,i)=>{
    const d=document.createElement('div');
    d.className='dot'+(i===0?' on':'');
    d.onclick=()=>go(i);
    dotsEl.appendChild(d);
  });
  function go(n){
    n=Math.max(0,Math.min(n,slides.length-1));
    if(n===cur)return;
    slides[cur].classList.remove('active');cur=n;
    slides[cur].classList.add('active');
    [...dotsEl.children].forEach((d,i)=>d.classList.toggle('on',i===cur));
  }
  document.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key===' ')go(cur+1);
    if(e.key==='ArrowLeft')go(cur-1);
  });
  document.getElementById('deck').addEventListener('click',e=>{
    if(e.target.closest('.dot')||e.target.closest('a'))return;
    e.clientX>window.innerWidth/2?go(cur+1):go(cur-1);
  });
</script>
</body>
</html>`;

const SEED_VISUAL = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Art of Visual Storytelling</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
.deck{width:100%;height:100%;position:relative}
.slide{position:absolute;inset:0;opacity:0;transition:opacity .35s ease;pointer-events:none;
  display:flex;flex-direction:column;justify-content:center;align-items:center;
  padding:80px;text-align:center}
.slide.active{opacity:1;pointer-events:auto}

.s1{background:linear-gradient(135deg,#1a0533,#3d0066,#660033)}
.s1 .eyebrow{font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:rgba(255,255,255,.5);margin-bottom:24px}
.s1 h1{font-size:72px;font-weight:900;color:#fff;line-height:1.0;max-width:720px}
.s1 h1 em{font-style:normal;
  background:linear-gradient(90deg,#ff6bdb,#ff9d6b);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.s1 .speaker{margin-top:48px;font-size:15px;color:rgba(255,255,255,.45)}

.s2{background:#0a0a0a}
.contrast-demo{display:flex;gap:0;border-radius:16px;overflow:hidden;margin-top:40px;width:500px}
.contrast-bad{background:#555;color:#777;padding:32px 40px;flex:1;font-size:20px;font-weight:600}
.contrast-good{background:#0a0a0a;color:#f5c518;padding:32px 40px;flex:1;font-size:20px;font-weight:600;border:1px solid #333}
.label-bad{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#666;margin-top:8px}
.label-good{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-top:8px}
.s2 h2{font-size:52px;font-weight:900;color:#fff}
.s2 h2 em{font-style:normal;color:#f5c518}

.s3{background:#fafaf8;color:#1a1a1a}
.s3 h2{font-size:84px;font-weight:900;color:#1a1a1a;line-height:1}
.s3 h2 span{color:#e5e5e5}
.s3 p{margin-top:32px;font-size:18px;color:#888;max-width:500px;line-height:1.6}

.s4{background:linear-gradient(160deg,#040404,#0a0014)}
.s4 .big-word{font-size:96px;font-weight:900;line-height:1;
  background:linear-gradient(135deg,#fff 0%,rgba(255,255,255,.2) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.s4 p{margin-top:32px;font-size:20px;color:rgba(255,255,255,.4);max-width:480px;line-height:1.6}
.s4 .rule{width:60px;height:3px;background:linear-gradient(90deg,#ff6bdb,#ff9d6b);
  margin:32px auto 0;border-radius:2px}

.dots{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:8px}
.dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.25);cursor:pointer;transition:all .2s}
.dot.on{width:20px;border-radius:4px;background:#ff6bdb}
.hint{position:absolute;bottom:26px;right:36px;font-size:11px;color:rgba(255,255,255,.2)}
</style>
</head>
<body>
<div class="deck" id="deck">

  <div class="slide s1 active">
    <div class="eyebrow">Design + Communication</div>
    <h1>The Art of <em>Visual Storytelling</em></h1>
    <div class="speaker">A short guide to making presentations that people actually remember</div>
  </div>

  <div class="slide s2">
    <h2><em>Contrast</em> is everything</h2>
    <div class="contrast-demo">
      <div>
        <div class="contrast-bad">Hard to read</div>
        <div class="label-bad">Low contrast = ignored</div>
      </div>
      <div>
        <div class="contrast-good">Hard to miss</div>
        <div class="label-good">High contrast = remembered</div>
      </div>
    </div>
  </div>

  <div class="slide s3">
    <h2><span>Less</span> is<br>more.</h2>
    <p>Every word you remove makes the words that remain 10× more powerful. Edit ruthlessly.</p>
  </div>

  <div class="slide s4">
    <div class="big-word">Breathe.</div>
    <p>White space is not empty space. It's the pause that gives your content room to land.</p>
    <div class="rule"></div>
  </div>

  <div class="dots" id="dots"></div>
  <div class="hint">← → to navigate</div>
</div>
<script>
  const slides=[...document.querySelectorAll('.slide')];
  const dotsEl=document.getElementById('dots');
  let cur=0;
  slides.forEach((_,i)=>{
    const d=document.createElement('div');
    d.className='dot'+(i===0?' on':'');
    d.onclick=()=>go(i);
    dotsEl.appendChild(d);
  });
  function go(n){
    n=Math.max(0,Math.min(n,slides.length-1));
    if(n===cur)return;
    slides[cur].classList.remove('active');cur=n;
    slides[cur].classList.add('active');
    [...dotsEl.children].forEach((d,i)=>d.classList.toggle('on',i===cur));
  }
  document.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'||e.key===' ')go(cur+1);
    if(e.key==='ArrowLeft')go(cur-1);
  });
  document.getElementById('deck').addEventListener('click',e=>{
    if(e.target.closest('.dot')||e.target.closest('a'))return;
    e.clientX>window.innerWidth/2?go(cur+1):go(cur-1);
  });
</script>
</body>
</html>`;

async function seedDemoDecks() {
  const count = db.prepare('SELECT COUNT(*) as c FROM decks').get().c;
  if (count > 0) return;

  console.log('[seed] Inserting demo presentations...');

  const seeds = [
    {
      title: 'Welcome to DeckPad',
      author: 'DeckPad Team',
      description: 'An introduction to DeckPad — the HTML presentation hosting platform. Upload any HTML deck and present it to the world.',
      tags: 'demo,welcome,intro,deckpad',
      html: SEED_WELCOME,
    },
    {
      title: 'Building for the Open Web',
      author: 'Web Standards',
      description: 'A talk about HTML, web standards, and why the open web platform wins. Covers interoperability, accessibility, and longevity.',
      tags: 'web,html,standards,open-source,tech',
      html: SEED_OPENWEB,
    },
    {
      title: 'The Art of Visual Storytelling',
      author: 'Design Thoughts',
      description: 'A short guide to making presentations that people actually remember. Covers contrast, white space, and the power of simplicity.',
      tags: 'design,presentations,visual,storytelling',
      html: SEED_VISUAL,
    },
  ];

  for (const seed of seeds) {
    const id = crypto.randomUUID();
    const deckDir = path.join(UPLOADS_DIR, id);
    fs.mkdirSync(deckDir, { recursive: true });
    fs.writeFileSync(path.join(deckDir, 'index.html'), seed.html);

    stmts.insert.run({
      id,
      title: seed.title,
      author: seed.author,
      description: seed.description,
      tags: seed.tags,
      filename: 'index.html',
      entry_point: 'index.html',
    });

    // Generate thumbnails after a short delay to ensure server is accepting connections
    setTimeout(() => {
      generateThumbnail(id, 'index.html').catch(err => {
        console.warn(`[seed thumb] ${seed.title}: ${err.message}`);
      });
    }, 1500);
  }

  console.log('[seed] Done.');
}

function seedPlatformData() {
  const bountyCount = db.prepare('SELECT COUNT(*) as c FROM bounties').get().c;
  if (bountyCount > 0) return;

  console.log('[seed] Inserting platform data...');

  // Events
  const eventId = crypto.randomUUID();
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    eventId, 'LR Demo Day #1',
    'Our first community demo day! Show us what you\'ve been building. 5-minute demos, lightning pitches, and good vibes.',
    'demo-day', '2026-04-10', '18:00', 'Virtual — Link TBA'
  );

  // Bounties — the 50k bounty is linked to the demo day event
  const bounties = [
    { title: 'Build a Voting System for Presentations', description: 'Add upvote/downvote capabilities to the DeckPad presentation gallery so the community can surface the best content.', sats_amount: 10000, status: 'completed', tags: 'deckpad,voting,frontend', event_id: null },
    { title: 'Best Demo at LR Demo Day #1', description: 'Best overall demo at the first LR Demo Day. Judged by audience vote. Ship something real.', sats_amount: 50000, status: 'open', tags: 'deckpad,platform,fullstack', event_id: eventId },
    { title: 'LNURL-Auth Integration', description: 'Integrate LNURL-Auth so builders can log in with their Lightning wallet — no email, no password, just a QR code scan.', sats_amount: 25000, status: 'open', tags: 'lightning,auth,bitcoin', event_id: null },
  ];
  for (const b of bounties) {
    db.prepare(`INSERT INTO bounties (id, title, description, sats_amount, status, tags, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), b.title, b.description, b.sats_amount, b.status, b.tags, b.event_id
    );
  }

  // Speakers — link to first two demo decks
  const allDecks = db.prepare('SELECT id, title FROM decks ORDER BY created_at ASC').all();
  const deckId1 = allDecks[0]?.id || null;
  const deckId2 = allDecks[1]?.id || null;
  const speakers = [
    { name: 'satsdisco', project_title: 'DeckPad', description: 'HTML presentation hosting platform with auto-thumbnails, voting, and a community gallery.', duration: 10, github_url: 'https://github.com/satsdisco/deckpad', demo_url: 'https://decks.satsdisco.com', deck_id: deckId1 },
    { name: 'noderunner', project_title: 'LNConnect', description: 'A simple dashboard for monitoring your Lightning node channels, capacity, and routing fees in real-time.', duration: 5, github_url: 'https://github.com/noderunner/lnconnect', demo_url: '', deck_id: deckId2 },
  ];
  for (const s of speakers) {
    db.prepare(`INSERT INTO speakers (id, event_id, name, project_title, description, duration, github_url, demo_url, deck_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), eventId, s.name, s.project_title, s.description, s.duration, s.github_url || null, s.demo_url || null, s.deck_id || null
    );
  }

  // Projects
  const projects = [
    { name: 'DeckPad', builder: 'satsdisco', description: 'Your stage for HTML presentations. Upload any HTML deck and share it with the world. Built with Express, SQLite, and Puppeteer.', status: 'building', tags: 'web,presentations,hosting,deckpad', repo_url: 'https://github.com/satsdisco/deckpad', demo_url: 'https://deckpad.app' },
    { name: 'LNConnect', builder: 'noderunner', description: 'Real-time Lightning node monitoring dashboard. Track channels, capacity, routing fees, and peer health from one place.', status: 'building', tags: 'lightning,bitcoin,dashboard,nodes', repo_url: 'https://github.com/noderunner/lnconnect', demo_url: '' },
  ];
  for (const p of projects) {
    db.prepare(`INSERT INTO projects (id, name, builder, description, status, tags, repo_url, demo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), p.name, p.builder, p.description, p.status, p.tags, p.repo_url || null, p.demo_url || null
    );
  }

  console.log('[seed] Platform data done.');
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🎭 DeckPad running at http://localhost:${PORT}\n`);
  seedDemoDecks().catch(console.error);
  seedPlatformData();
});

// SPA catch-all — serve index for unknown routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 50MB)' });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = { app, server };
