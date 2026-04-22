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
const QRCode = require('qrcode');
const { filterPublicLeaderboardRows } = require('./public/js/ui-rules.js');
const {
  filterPublicComments,
  filterPublicIdeas,
  filterPublicProjects,
  hasBlockedCommentContent,
  isPlaceholderIdea,
  isPlaceholderProject,
} = require('./content-rules.js');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 3100;
const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const THUMBNAILS_DIR = path.join(ROOT, 'thumbnails');
const TEMP_DIR = path.join(ROOT, 'temp');
const AVATARS_DIR = path.join(ROOT, 'avatars');
const DB_PATH = path.join(ROOT, 'deckpad.db');
const ADMIN_LN_ADDRESS = 'lunarpad@21m.lol';
const LNBITS_URL = process.env.LNBITS_URL || 'https://21m.lol';
const LNBITS_INVOICE_KEY = process.env.LNBITS_INVOICE_KEY || '';
const LNBITS_ADMIN_KEY = process.env.LNBITS_ADMIN_KEY || '';
const LNBITS_WEBHOOK_SECRET = process.env.LNBITS_WEBHOOK_SECRET || '';

for (const dir of [UPLOADS_DIR, THUMBNAILS_DIR, TEMP_DIR, AVATARS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const FALLBACK_EVENT_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Athens',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];
const SUPPORTED_EVENT_TIMEZONES = new Set(
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : FALLBACK_EVENT_TIMEZONES
);

function normalizeEventTimezone(value) {
  const timezone = String(value || '').trim();
  return timezone && SUPPORTED_EVENT_TIMEZONES.has(timezone) ? timezone : 'UTC';
}

function getTimeZoneOffsetMinutes(timeZone, utcDate) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(utcDate)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - utcDate.getTime()) / 60000);
}

function resolveEventStartUtc(date, time, eventTimezone) {
  if (!date || !time) return null;
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match || !timeMatch) return null;
  const [, year, month, day] = match;
  const [, hour, minute, second = '00'] = timeMatch;
  const timezone = normalizeEventTimezone(eventTimezone);
  const naiveUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  let offsetMinutes = getTimeZoneOffsetMinutes(timezone, new Date(naiveUtc));
  let resolvedUtc = naiveUtc - (offsetMinutes * 60000);
  const correctedOffset = getTimeZoneOffsetMinutes(timezone, new Date(resolvedUtc));
  if (correctedOffset !== offsetMinutes) {
    offsetMinutes = correctedOffset;
    resolvedUtc = naiveUtc - (offsetMinutes * 60000);
  }
  return new Date(resolvedUtc).toISOString();
}

// ─── Database ────────────────────────────────────────────────────────────────

// DB persists across restarts — schema uses CREATE TABLE IF NOT EXISTS

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    google_id     TEXT UNIQUE,
    username      TEXT,
    email         TEXT,
    name          TEXT,
    avatar        TEXT,
    password_hash TEXT,
    is_admin      INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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
    created_by  TEXT,
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
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    event_type     TEXT DEFAULT 'demo-day',
    date           TEXT NOT NULL,
    time           TEXT,
    end_time       TEXT,
    event_timezone TEXT DEFAULT 'UTC',
    starts_at_utc  TEXT,
    ends_at_utc    TEXT,
    location       TEXT,
    virtual_link   TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
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
    scheduled_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    status        TEXT DEFAULT 'scheduled',
    presented_at  TEXT,
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
    deck_id     TEXT,
    repo_url    TEXT,
    demo_url    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bounty_payments (
    id              TEXT PRIMARY KEY,
    bounty_id       TEXT NOT NULL,
    user_id         TEXT,
    user_name       TEXT,
    amount_sats     INTEGER NOT NULL,
    payment_type    TEXT NOT NULL DEFAULT 'fund',
    payment_request TEXT,
    payment_hash    TEXT,
    verify_url      TEXT,
    status          TEXT DEFAULT 'pending',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at    DATETIME,
    FOREIGN KEY (bounty_id) REFERENCES bounties(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS zaps (
    id              TEXT PRIMARY KEY,
    target_type     TEXT NOT NULL,
    target_id       TEXT NOT NULL,
    user_id         TEXT,
    user_name       TEXT,
    amount_sats     INTEGER NOT NULL,
    payment_request TEXT,
    payment_hash    TEXT,
    verify_url      TEXT,
    status          TEXT DEFAULT 'pending',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at    DATETIME
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS project_decks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    deck_id     TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    label       TEXT,
    is_current  INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (deck_id) REFERENCES decks(id)
  );
`);

// ─── Migration System ──────────────────────────────────────────────────────
// Each migration runs exactly once. Tracked in _migrations table.
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const MIGRATIONS = [
  // v1-v5: Column additions (originally untracked ALTER TABLEs)
  { name: 'v001_user_fields', sql: [
    'ALTER TABLE users ADD COLUMN lightning_address TEXT',
    'ALTER TABLE users ADD COLUMN badges TEXT',
    'ALTER TABLE users ADD COLUMN total_sats_received INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN website_url TEXT',
    'ALTER TABLE users ADD COLUMN github_url TEXT',
  ]},
  { name: 'v002_bounty_fields', sql: [
    'ALTER TABLE bounties ADD COLUMN winner_id TEXT',
    'ALTER TABLE bounties ADD COLUMN winner_name TEXT',
    'ALTER TABLE bounties ADD COLUMN paid_out INTEGER DEFAULT 0',
    'ALTER TABLE bounties ADD COLUMN funded_amount INTEGER DEFAULT 0',
  ]},
  { name: 'v003_project_sats', sql: [
    'ALTER TABLE projects ADD COLUMN total_sats_received INTEGER DEFAULT 0',
  ]},
  { name: 'v004_payment_fields', sql: [
    'ALTER TABLE bounty_payments ADD COLUMN payment_hash TEXT',
    'ALTER TABLE zaps ADD COLUMN payment_hash TEXT',
    'ALTER TABLE zaps ADD COLUMN recipient_address TEXT',
    'ALTER TABLE zaps ADD COLUMN forward_status TEXT',
    'ALTER TABLE zaps ADD COLUMN forward_payment_hash TEXT',
  ]},
  { name: 'v005_deck_project_fields', sql: [
    'ALTER TABLE decks ADD COLUMN hidden INTEGER DEFAULT 0',
    'ALTER TABLE projects ADD COLUMN banner_url TEXT',
    'ALTER TABLE projects ADD COLUMN thumbnail_url TEXT',
    'ALTER TABLE decks ADD COLUMN total_sats_received INTEGER DEFAULT 0',
  ]},
  { name: 'v006_slugs', sql: [
    'ALTER TABLE decks ADD COLUMN slug TEXT',
    'ALTER TABLE projects ADD COLUMN slug TEXT',
  ]},
  { name: 'v007_slug_indexes', sql: [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_slug ON decks(slug) WHERE slug IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug) WHERE slug IS NOT NULL',
  ]},
  { name: 'v008_live_sessions', sql: [
    `CREATE TABLE IF NOT EXISTS live_sessions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      current_speaker_id TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
  ]},
  { name: 'v009_notifications', sql: [
    `CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      actor_id    TEXT,
      actor_name  TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      target_name TEXT,
      read        INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at)',
  ]},
  { name: 'v010_comment_replies', sql: [
    'ALTER TABLE comments ADD COLUMN parent_id TEXT',
    'CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)',
  ]},
  { name: 'v011_ideas', sql: [
    `CREATE TABLE IF NOT EXISTS ideas (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT,
      user_id             TEXT,
      slug                TEXT,
      total_sats_received INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS idea_members (
      id         TEXT PRIMARY KEY,
      idea_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    'ALTER TABLE comments ADD COLUMN target_type TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_slug ON ideas(slug) WHERE slug IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_idea_members_idea ON idea_members(idea_id)',
  ]},
  { name: 'v012_idea_conversion', sql: [
    'ALTER TABLE ideas ADD COLUMN converted_to_project_id TEXT',
    'ALTER TABLE projects ADD COLUMN source_idea_id TEXT',
  ]},
  { name: 'v013_idea_views', sql: [
    'ALTER TABLE ideas ADD COLUMN views_today INTEGER DEFAULT 0',
    'ALTER TABLE ideas ADD COLUMN views_date TEXT',
  ]},
  { name: 'v014_zap_notes', sql: [
    'ALTER TABLE zaps ADD COLUMN note TEXT',
  ]},
  { name: 'v015_marketplace', sql: [
    'ALTER TABLE ideas ADD COLUMN looking_for TEXT',
    'ALTER TABLE users ADD COLUMN skills TEXT',
    'ALTER TABLE users ADD COLUMN available_hours INTEGER',
  ]},
  { name: 'v016_rsvp_user_id', sql: [
    'ALTER TABLE rsvps ADD COLUMN user_id TEXT',
  ]},
  { name: 'v017_speaker_user_id', sql: [
    'ALTER TABLE speakers ADD COLUMN user_id TEXT',
  ]},
  { name: 'v018_user_banner_preset', sql: [
    'ALTER TABLE users ADD COLUMN banner_preset TEXT',
  ]},
  { name: 'v019_speaker_presented_state', sql: [
    'ALTER TABLE speakers ADD COLUMN scheduled_at TEXT',
    "ALTER TABLE speakers ADD COLUMN status TEXT DEFAULT 'scheduled'",
    'ALTER TABLE speakers ADD COLUMN presented_at TEXT',
    "UPDATE speakers SET scheduled_at = COALESCE(scheduled_at, created_at, datetime('now'))",
    "UPDATE speakers SET status = CASE WHEN presented_at IS NOT NULL THEN 'presented' ELSE COALESCE(status, 'scheduled') END",
    'CREATE INDEX IF NOT EXISTS idx_speakers_user_status ON speakers(user_id, status, presented_at)',
  ]},
  { name: 'v021_speaker_schedule_repair', sql: [
    'ALTER TABLE speakers ADD COLUMN scheduled_at TEXT',
    "UPDATE speakers SET scheduled_at = COALESCE(scheduled_at, created_at, datetime('now'))",
  ]},
  { name: 'v020_lunar_hangout_phase0', sql: [
    "ALTER TABLE live_sessions ADD COLUMN mode TEXT DEFAULT 'demo-day-live'",
    "ALTER TABLE live_sessions ADD COLUMN status TEXT DEFAULT 'idle'",
    'ALTER TABLE live_sessions ADD COLUMN voting_open INTEGER DEFAULT 0',
    'ALTER TABLE live_sessions ADD COLUMN current_started_at TEXT',
    'ALTER TABLE live_sessions ADD COLUMN current_duration_minutes INTEGER DEFAULT 10',
    'ALTER TABLE live_sessions ADD COLUMN winner_speaker_id TEXT',
    'ALTER TABLE live_sessions ADD COLUMN winner_confirmed_at TEXT',
    "ALTER TABLE live_sessions ADD COLUMN payout_status TEXT DEFAULT 'pending'",
    'ALTER TABLE live_sessions ADD COLUMN meet_url TEXT',
    'ALTER TABLE live_sessions ADD COLUMN ended_at TEXT',
    'ALTER TABLE speakers ADD COLUMN queue_position INTEGER',
    'ALTER TABLE speakers ADD COLUMN skipped_at TEXT',
    `CREATE TABLE IF NOT EXISTS event_results (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      winner_speaker_id TEXT,
      winner_name TEXT,
      winner_project_title TEXT,
      total_votes INTEGER DEFAULT 0,
      total_zaps INTEGER DEFAULT 0,
      results_json TEXT,
      summary_markdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS idx_event_results_event ON event_results(event_id)',
    `UPDATE live_sessions
      SET mode = COALESCE(mode, 'demo-day-live'),
          status = CASE
            WHEN COALESCE(is_active, 0) = 1 THEN 'live'
            ELSE COALESCE(status, 'idle')
          END,
          voting_open = COALESCE(voting_open, 0),
          current_duration_minutes = COALESCE(current_duration_minutes, 10),
          payout_status = COALESCE(payout_status, 'pending'),
          meet_url = COALESCE(meet_url, (SELECT virtual_link FROM events WHERE events.id = live_sessions.event_id))`,
    `UPDATE speakers
      SET queue_position = (
        SELECT COUNT(*)
        FROM speakers s2
        WHERE s2.event_id = speakers.event_id
          AND (
            COALESCE(s2.scheduled_at, s2.created_at, datetime('now')) < COALESCE(speakers.scheduled_at, speakers.created_at, datetime('now'))
            OR (
              COALESCE(s2.scheduled_at, s2.created_at, datetime('now')) = COALESCE(speakers.scheduled_at, speakers.created_at, datetime('now'))
              AND s2.id <= speakers.id
            )
          )
      )
      WHERE queue_position IS NULL`,
    `UPDATE speakers
      SET status = CASE
        WHEN presented_at IS NOT NULL THEN 'presented'
        WHEN skipped_at IS NOT NULL THEN 'skipped'
        ELSE COALESCE(status, 'scheduled')
      END`,
    'CREATE INDEX IF NOT EXISTS idx_speakers_event_queue ON speakers(event_id, queue_position, status)',
  ]},
  { name: 'v022_rsvp_dedup_guards', sql: [
    `DELETE FROM rsvps
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM rsvps
        WHERE user_id IS NOT NULL
        GROUP BY event_id, user_id
      )
      AND user_id IS NOT NULL`,
    `DELETE FROM rsvps
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM rsvps
        GROUP BY event_id, lower(COALESCE(email, ''))
      )
      AND user_id IS NULL
      AND email IS NOT NULL`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_event_user_unique ON rsvps(event_id, user_id) WHERE user_id IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_event_email_unique ON rsvps(event_id, lower(email)) WHERE email IS NOT NULL',
  ]},
  { name: 'v023_event_timezones', sql: [
    "ALTER TABLE events ADD COLUMN event_timezone TEXT DEFAULT 'UTC'",
    'ALTER TABLE events ADD COLUMN starts_at_utc TEXT',
    "UPDATE events SET event_timezone = COALESCE(NULLIF(event_timezone, ''), 'UTC')",
  ]},
  { name: 'v024_event_end_times', sql: [
    'ALTER TABLE events ADD COLUMN end_time TEXT',
    'ALTER TABLE events ADD COLUMN ends_at_utc TEXT',
  ]},
  { name: 'v025_bounty_creators', sql: [
    'ALTER TABLE bounties ADD COLUMN created_by TEXT',
  ]},
];

// Run pending migrations
const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
for (const m of MIGRATIONS) {
  if (applied.has(m.name)) continue;
  console.log(`[migration] Running ${m.name}...`);
  for (const sql of m.sql) {
    try { db.exec(sql); } catch (e) {
      // Ignore "duplicate column" / "already exists" errors
      if (!e.message?.includes('duplicate') && !e.message?.includes('already exists')) {
        console.error(`[migration] ${m.name} warning:`, e.message);
      }
    }
  }
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name);
  console.log(`[migration] ✓ ${m.name}`);
}

function backfillEventStartInstants() {
  const rows = db.prepare('SELECT id, date, time, end_time, event_timezone FROM events').all();
  const update = db.prepare('UPDATE events SET event_timezone = ?, starts_at_utc = ?, ends_at_utc = ? WHERE id = ?');
  for (const row of rows) {
    const eventTimezone = normalizeEventTimezone(row.event_timezone);
    const startsAtUtc = resolveEventStartUtc(row.date, row.time, eventTimezone);
    const endsAtUtc = row.end_time ? resolveEventStartUtc(row.date, row.end_time, eventTimezone) : null;
    update.run(eventTimezone, startsAtUtc, endsAtUtc, row.id);
  }
}

backfillEventStartInstants();

// ─── Badge definitions ────────────────────────────────────────────────────────

const BADGES = {
  first_build:    { id: 'first_build',    emoji: '🔨', name: 'First Build',        desc: 'Submitted your first project' },
  first_sats:     { id: 'first_sats',     emoji: '⚡', name: 'First Sats',         desc: 'Won your first bounty' },
  demo_champ:     { id: 'demo_champ',     emoji: '🏆', name: 'Demo Day Champion',  desc: 'Won a demo day bounty' },
  streak:         { id: 'streak',         emoji: '🔥', name: 'On a Streak',        desc: 'Submitted projects in 2+ events' },
  zap_master:     { id: 'zap_master',     emoji: '⚡', name: 'Zap Master',         desc: 'Zapped 5+ projects' },
  generous:       { id: 'generous',       emoji: '💰', name: 'Big Spender',         desc: 'Added to 3+ bounty prize pools' },
  popular:        { id: 'popular',        emoji: '🌟', name: 'Popular Project',    desc: 'Received 10+ votes on a project' },
  early_adopter:  { id: 'early_adopter',  emoji: '🚀', name: 'Early Adopter',      desc: 'Joined in the first month' },
  presenter:      { id: 'presenter',      emoji: '🎤', name: 'Presenter',          desc: 'Presented at a demo day' },
  bounty_hunter:  { id: 'bounty_hunter',  emoji: '🎯', name: 'Bounty Hunter',      desc: 'Completed 3+ bounties' },
};

function checkAndAwardBadges(userId) {
  const user = db.prepare('SELECT badges, name, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return;
  let badges = [];
  try { badges = JSON.parse(user.badges || '[]'); } catch { badges = []; }
  const has = (id) => badges.includes(id);

  if (!has('first_build')) {
    const c = db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id = ?').get(userId)?.c || 0;
    if (c >= 1) badges.push('first_build');
  }
  if (!has('first_sats')) {
    const won = db.prepare('SELECT id FROM bounties WHERE winner_id = ? AND paid_out = 1').get(userId);
    if (won) badges.push('first_sats');
  }
  if (!has('demo_champ')) {
    const champ = db.prepare(`
      SELECT b.id FROM bounties b
      JOIN events e ON b.event_id = e.id
      WHERE b.winner_id = ? AND e.event_type = 'demo-day'
    `).get(userId);
    if (champ) badges.push('demo_champ');
  }
  if (!has('streak')) {
    const ev = db.prepare(`
      SELECT COUNT(DISTINCT b.event_id) as cnt
      FROM projects p JOIN bounties b ON p.bounty_id = b.id
      WHERE p.user_id = ? AND b.event_id IS NOT NULL
    `).get(userId);
    if (ev && ev.cnt >= 2) badges.push('streak');
  }
  if (!has('zap_master')) {
    const z = db.prepare(`SELECT COUNT(*) as c FROM zaps WHERE user_id = ? AND status = 'confirmed'`).get(userId)?.c || 0;
    if (z >= 5) badges.push('zap_master');
  }
  if (!has('generous')) {
    const g = db.prepare(`SELECT COUNT(*) as c FROM bounty_payments WHERE user_id = ? AND payment_type = 'fund' AND status = 'confirmed'`).get(userId)?.c || 0;
    if (g >= 3) badges.push('generous');
  }
  if (!has('popular')) {
    const pop = db.prepare(`
      SELECT COUNT(*) as c FROM votes v
      JOIN projects p ON v.target_id = p.id
      WHERE v.target_type = 'project' AND p.user_id = ?
      GROUP BY v.target_id
      HAVING c >= 10
    `).get(userId);
    if (pop) badges.push('popular');
  }
  if (!has('early_adopter')) {
    const earliest = db.prepare('SELECT MIN(created_at) as first FROM users').get()?.first;
    if (earliest) {
      const diff = new Date(user.created_at) - new Date(earliest);
      if (diff <= 30 * 24 * 60 * 60 * 1000) badges.push('early_adopter');
    }
  }
  if (!has('presenter')) {
    const pres = db.prepare('SELECT s.id FROM speakers s WHERE s.user_id = ? AND s.presented_at IS NOT NULL LIMIT 1').get(userId);
    if (pres) badges.push('presenter');
  }
  if (!has('bounty_hunter')) {
    const bh = db.prepare(`SELECT COUNT(*) as c FROM bounties WHERE winner_id = ? AND status = 'completed'`).get(userId)?.c || 0;
    if (bh >= 3) badges.push('bounty_hunter');
  }

  db.prepare('UPDATE users SET badges = ? WHERE id = ?').run(JSON.stringify(badges), userId);
}

const badgeCheckCache = new Map(); // userId -> last check timestamp (ms)
function cachedBadgeCheck(userId) {
  const now = Date.now();
  const last = badgeCheckCache.get(userId) || 0;
  if (now - last < 60000) return;
  badgeCheckCache.set(userId, now);
  checkAndAwardBadges(userId);
}

function getUpcomingPresenterState(userId) {
  if (!userId) return false;
  const upcoming = db.prepare(`
    SELECT s.id
    FROM speakers s
    WHERE s.user_id = ?
      AND COALESCE(s.status, 'scheduled') = 'scheduled'
      AND s.presented_at IS NULL
    LIMIT 1
  `).get(userId);
  return !!upcoming;
}

// ─── Slug helpers ────────────────────────────────────────────────────────────

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deck';
}

function uniqueSlug(table, base) {
  let slug = base;
  let n = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO decks (id, title, author, description, tags, filename, entry_point, github_url, demo_url, uploaded_by, slug)
    VALUES (@id, @title, @author, @description, @tags, @filename, @entry_point, @github_url, @demo_url, @uploaded_by, @slug)
  `),
  findUserByGoogleId: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  insertUser:         db.prepare('INSERT INTO users (id, google_id, email, name, avatar) VALUES (?, ?, ?, ?, ?)'),
  getUserById:        db.prepare('SELECT * FROM users WHERE id = ?'),
  getById:       db.prepare('SELECT * FROM decks WHERE id = ?'),
  setThumbnail:  db.prepare('UPDATE decks SET thumbnail = ? WHERE id = ?'),
  incrementView: db.prepare('UPDATE decks SET views = views + 1 WHERE id = ?'),
  count:         db.prepare('SELECT COUNT(*) as c FROM decks'),
  allTags:       db.prepare("SELECT tags FROM decks WHERE tags IS NOT NULL AND tags != '' AND (hidden = 0 OR hidden IS NULL)"),
  deleteDeck:    db.prepare('DELETE FROM decks WHERE id = ?'),
  addVote:       db.prepare('INSERT OR IGNORE INTO votes (target_type, target_id, voter_ip) VALUES (?, ?, ?)'),
  removeVote:    db.prepare('DELETE FROM votes WHERE target_type = ? AND target_id = ? AND voter_ip = ?'),
  getVoteCount:  db.prepare('SELECT COUNT(*) as c FROM votes WHERE target_type = ? AND target_id = ?'),
  hasVoted:      db.prepare('SELECT 1 FROM votes WHERE target_type = ? AND target_id = ? AND voter_ip = ?'),
  deleteVotes:   db.prepare('DELETE FROM votes WHERE target_type = ? AND target_id = ?'),
  insertNotification: db.prepare('INSERT INTO notifications (id, user_id, type, actor_id, actor_name, target_type, target_id, target_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getUnreadCount:     db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0'),
  getNotificationsCount: db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ?'),
  getRecentNotifs:    db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'),
  getNotificationsPage: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'),
  markNotifRead:      db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?'),
  markAllNotifsRead:  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0'),
  insertIdea:    db.prepare('INSERT INTO ideas (id, title, description, user_id, slug, total_sats_received) VALUES (?, ?, ?, ?, ?, 0)'),
  getIdeaById:   db.prepare('SELECT * FROM ideas WHERE id = ?'),
};

function notify(userId, type, actorId, actorName, targetType, targetId, targetName) {
  if (!userId || userId === actorId) return;
  try {
    stmts.insertNotification.run(crypto.randomUUID(), userId, type, actorId || null, actorName, targetType, targetId, targetName || null);
  } catch (e) { console.error('[notify]', e.message); }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.disable('x-powered-by');
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS — enforce HTTPS on return visits (1 year)
  if (process.env.BASE_URL) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Permissions-Policy — lock down browser APIs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  // CSP — restrict script/style/connect sources
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isSecure = process.env.NODE_ENV === 'production' || !!process.env.BASE_URL;
// Trust proxy (Cloudflare tunnel terminates TLS)
if (isSecure) app.set('trust proxy', 1);
app.use(cookieSession({
  name: 'deckpad_session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  sameSite: 'lax',
  secure: isSecure,
  httpOnly: true,
  path: '/',
}));

// Rolling sessions — refresh cookie on each request
app.use((req, res, next) => {
  if (req.session) req.session.nowInMinutes = Math.floor(Date.now() / 60000);
  next();
});

function isLocalDevAutoLoginRequest(req) {
  const host = String(req.hostname || '').toLowerCase();
  return !process.env.BASE_URL && ['localhost', '127.0.0.1', '::1'].includes(host);
}

function isStagingQaHost(req) {
  const host = String(req.hostname || '').toLowerCase();
  return host === 'decks.satsdisco.com';
}

app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    req.user = stmts.getUserById.get(req.session.userId);
  }
  // Auto-login as dev user in local development only
  if (!req.user && isLocalDevAutoLoginRequest(req)) {
    const which = req.session?.devUser || 'alice';
    let devUser = db.prepare("SELECT * FROM users WHERE username = ?").get(which);
    if (!devUser) {
      const id = crypto.randomUUID();
      const isAlice = which === 'alice';
      db.prepare("INSERT INTO users (id, username, email, name, is_admin) VALUES (?, ?, ?, ?, ?)").run(
        id, which, which + '@localhost', isAlice ? 'Alice (Dev)' : 'Bob (Dev)', isAlice ? 1 : 0
      );
      devUser = stmts.getUserById.get(id);
    }
    req.user = devUser;
    if (req.session) req.session.userId = devUser.id;
  }
  next();
});

// Static files (index: false so auth wall handles /)
app.use(express.static(path.join(ROOT, 'public'), { index: false }));
app.use('/thumbnails', express.static(THUMBNAILS_DIR));
app.use('/avatars', express.static(AVATARS_DIR));

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
  if (!code) { console.error('[auth] No code in callback'); return res.redirect('/welcome'); }

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

    // Find or create user — with account linking
    let user = stmts.findUserByGoogleId.get(profile.id);

    if (!user && profile.email) {
      // Check if an existing account has this email — link it
      const existingByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
      if (existingByEmail) {
        db.prepare('UPDATE users SET google_id = ?, avatar = COALESCE(avatar, ?) WHERE id = ?').run(
          profile.id, profile.picture || null, existingByEmail.id
        );
        user = stmts.getUserById.get(existingByEmail.id);
        console.log(`[auth] Linked Google account to existing user: ${existingByEmail.name} (${existingByEmail.id})`);
      }
    }

    if (!user && req.session?.userId) {
      // User is already logged in — link Google to their current account
      const current = stmts.getUserById.get(req.session.userId);
      if (current && !current.google_id) {
        db.prepare('UPDATE users SET google_id = ?, email = COALESCE(email, ?), avatar = COALESCE(avatar, ?) WHERE id = ?').run(
          profile.id, profile.email || null, profile.picture || null, current.id
        );
        user = stmts.getUserById.get(current.id);
        console.log(`[auth] Linked Google to logged-in user: ${current.name} (${current.id})`);
      }
    }

    if (!user) {
      // Brand new user — create account
      const id = crypto.randomUUID();
      stmts.insertUser.run(id, profile.id, profile.email || null, profile.name || null, profile.picture || null);
      user = stmts.getUserById.get(id);
      console.log(`[auth] Created new Google user: ${profile.name} (${id})`);
    }

    // Update avatar if missing
    if (user && !user.avatar && profile.picture) {
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(profile.picture, user.id);
    }

    req.session.userId = user.id;
    res.redirect('/');
  } catch (err) {
    console.error('[auth] OAuth callback error:', err);
    res.redirect('/welcome');
  }
});

// ─── Simple Auth (username/password) ──────────────────────────────────────────
const bcrypt = require('bcryptjs');

app.post('/auth/register', async (req, res) => {
  return res.status(403).json({ error: 'Registration is currently closed' });
  const { username, password, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Username taken' });
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, username, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id, username.toLowerCase(), name || username, hash
  );
  req.session.userId = id;
  res.json({ ok: true });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.toLowerCase(), username.toLowerCase());
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.json({ ok: true });
});

// Dev user switcher (local only)
app.get('/dev/switch/:name', (req, res) => {
  if (!isLocalDevAutoLoginRequest(req)) return res.status(404).send('Not found');
  const name = req.params.name;
  if (!['alice', 'bob'].includes(name)) return res.status(400).send('Use /dev/switch/alice or /dev/switch/bob');
  req.session.devUser = name;
  req.session.userId = null;
  res.redirect('/');
});

app.get('/auth/staging-login/:username', (req, res) => {
  if (!isStagingQaHost(req)) return res.status(404).send('Not found');
  const username = String(req.params.username || '').toLowerCase();
  if (!username.startsWith('stg_')) return res.status(400).send('Staging QA login only supports stg_ accounts');
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).send('Staging QA user not found');
  req.session.devUser = null;
  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/auth/logout', (req, res) => {
  req.session = null;
  res.clearCookie('deckpad_session');
  res.clearCookie('deckpad_session.sig');
  res.clearCookie('__Host-deckpad_session');
  res.clearCookie('__Host-deckpad_session.sig');
  res.redirect('/welcome');
});

app.get('/api/me', (req, res) => {
  if (req.user) {
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar, is_admin: !!req.user.is_admin, lightning_address: req.user.lightning_address || null, bio: req.user.bio || null, website_url: req.user.website_url || null, github_url: req.user.github_url || null, banner_preset: req.user.banner_preset || null, has_google: !!req.user.google_id, skills: req.user.skills || null, available_hours: req.user.available_hours || null } });
  } else {
    res.json({ user: null });
  }
});

// PUT /api/me/availability — update skills and availability
app.put('/api/me/availability', requireAuth, (req, res) => {
  const { skills, available_hours } = req.body;
  const skillsStr = Array.isArray(skills) ? skills.join(',') : (skills || null);
  const hasAvailability = available_hours !== null && available_hours !== undefined && String(available_hours).trim() !== '';
  const hours = hasAvailability ? parseInt(available_hours, 10) : null;
  db.prepare('UPDATE users SET skills = ?, available_hours = ? WHERE id = ?').run(skillsStr, Number.isNaN(hours) ? null : hours, req.user.id);
  res.json({ ok: true });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect('/welcome');
}


function canManageProject(project, user) {
  if (!project || !user) return false;
  if (user.is_admin) return true;
  return !!project.user_id && user.id === project.user_id;
}


function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  res.status(403).json({ error: "Admin access required" });
}

// Promote user to admin by email (admin only)
app.post("/api/admin/promote", requireAuth, requireAdmin, function(req, res) {
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

app.get('/',         requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'build.html')));
app.get('/decks',    requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/upload',   requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'upload.html')));
app.get('/deck/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'deck.html')));
app.get('/build',    requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'build.html')));
// Deep-link aliases for SPA sidebar sections
app.get('/events',      requireAuth, (_, res) => res.redirect('/#events'));
app.get('/projects',    requireAuth, (_, res) => res.redirect('/#projects'));
app.get('/bounties',    requireAuth, (_, res) => res.redirect('/#bounties'));
app.get('/bounties/completed', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'bounties-completed.html')));
app.get('/leaderboard', requireAuth, (_, res) => res.redirect('/#leaderboard'));
app.get('/speakers',    requireAuth, (_, res) => res.redirect('/#speakers'));
// Catch bare routes without IDs — redirect to Build in Public
app.get('/event', requireAuth, (_, res) => res.redirect('/'));
app.get('/event/', requireAuth, (_, res) => res.redirect('/'));
app.get('/project', requireAuth, (_, res) => res.redirect('/'));
app.get('/project/', requireAuth, (_, res) => res.redirect('/'));
app.get('/bounty', requireAuth, (_, res) => res.redirect('/'));
app.get('/bounty/', requireAuth, (_, res) => res.redirect('/'));

app.get('/event/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'event.html')));
app.get('/project/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'project.html')));
app.get('/profile', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
app.get('/profile/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'profile.html')));
app.get('/notifications', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'notifications.html')));
app.get('/vote',     requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'vote.html')));
app.get('/admin',    requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/bounty/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'bounty.html')));
app.get('/live/:eventId', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'live.html')));

// Slug-based short URLs
app.get('/d/:slug', requireAuth, (req, res) => {
  const deck = db.prepare('SELECT id FROM decks WHERE slug = ?').get(req.params.slug);
  if (!deck) return res.redirect('/decks');
  res.redirect(301, `/deck/${deck.id}`);
});
app.get('/p/:slug', requireAuth, (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(req.params.slug);
  if (!project) return res.redirect('/');
  res.redirect(301, `/project/${project.id}`);
});
app.get('/f/:slug', requireAuth, (req, res) => {
  const idea = db.prepare('SELECT id FROM ideas WHERE slug = ?').get(req.params.slug);
  if (!idea) return res.redirect('/foyer');
  res.redirect(301, `/foyer/${idea.id}`);
});
app.get('/foyer',     requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'foyer.html')));
app.get('/foyer/:id', requireAuth, (_, res) => res.sendFile(path.join(ROOT, 'public', 'foyer-detail.html')));

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

const avatarUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) cb(null, true);
    else cb(new Error('Only jpg, png, gif, or webp images are accepted'));
  },
});

const bannerUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) cb(null, true);
    else cb(new Error('Only jpg, png, or webp images are accepted'));
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
  const slug = uniqueSlug('decks', toSlug(title.trim()));
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
      slug,
    });

    // Async thumbnail — don't block the response
    generateThumbnail(id, entryPoint).catch(err => {
      console.warn(`[thumb] ${id}: ${err.message}`);
    });

    res.json({ id, slug, title: title.trim() });
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

  // Exclude hidden decks (project versions) unless admin requests them
  if (!(req.query.include_hidden === 'true' && req.user?.is_admin)) {
    conditions.push('(hidden = 0 OR hidden IS NULL)');
  }

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
  // Find linked project
  const project = db.prepare('SELECT id, name, builder FROM projects WHERE deck_id = ? LIMIT 1').get(req.params.id);
  if (project) { deck.project_id = project.id; deck.project_name = project.name; deck.project_builder = project.builder; }
  res.json(deck);
});

// POST /api/decks/:id/view
app.post('/api/decks/:id/view', (req, res) => {
  stmts.incrementView.run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/decks/:id
app.delete('/api/decks/:id', requireAuth, (req, res) => {
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  // Only owner or admin can delete
  if (deck.uploaded_by && deck.uploaded_by !== req.user?.id && !req.user?.is_admin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

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

// GET /api/decks/:id/qr — generate QR code PNG for deck share URL
app.get('/api/decks/:id/qr', async (req, res) => {
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  const base = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const url = deck.slug ? `${base}/d/${deck.slug}` : `${base}/deck/${deck.id}`;
  try {
    const buffer = await QRCode.toBuffer(url, {
      type: 'png', width: 300, margin: 2,
      color: { dark: '#e8e6f0', light: '#0d0f1a' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
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
  const rows = db.prepare(`
    SELECT b.*, COALESCE(pc.cnt, 0) as participant_count
    FROM bounties b
    LEFT JOIN (SELECT bounty_id, COUNT(*) as cnt FROM bounty_participants GROUP BY bounty_id) pc ON b.id = pc.bounty_id
    ORDER BY b.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/bounties', requireAuth, (req, res) => {
  const { title, description, sats_amount, sats, deadline, status, tags, event_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO bounties (id, title, description, sats_amount, deadline, status, tags, event_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title.trim(), description || null,
    parseInt(sats_amount || sats) || 0, deadline || null,
    status || 'open', Array.isArray(tags) ? tags.join(',') : (tags || null),
    event_id || null, req.user.id
  );
  res.json({ id });
});

app.get('/api/bounties/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.participants = db.prepare('SELECT id, user_id, user_name, created_at FROM bounty_participants WHERE bounty_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(row);
});

app.put('/api/bounties/:id', requireAuth, (req, res) => {
  const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_admin && bounty.created_by !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  const { title, description, sats_amount, deadline, tags, event_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const linkedEvent = event_id ? db.prepare('SELECT id FROM events WHERE id = ?').get(event_id) : null;
  if (event_id && !linkedEvent) return res.status(400).json({ error: 'Linked event not found' });
  const nextAmount = parseInt(sats_amount) || 0;
  if (!nextAmount) return res.status(400).json({ error: 'reward amount required' });
  const confirmedFunding = db.prepare("SELECT COUNT(*) as c FROM bounty_payments WHERE bounty_id = ? AND payment_type = 'fund' AND status = 'confirmed'").get(req.params.id)?.c || 0;
  if (confirmedFunding > 0 && nextAmount !== Number(bounty.sats_amount || 0)) {
    return res.status(409).json({ error: 'Reward amount can no longer change after funding starts' });
  }
  db.prepare('UPDATE bounties SET title = ?, description = ?, sats_amount = ?, deadline = ?, tags = ?, event_id = ? WHERE id = ?').run(
    title.trim(),
    description || null,
    nextAmount,
    deadline || null,
    Array.isArray(tags) ? tags.join(',') : (tags || null),
    event_id || null,
    req.params.id
  );
  res.json({ ok: true });
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
  const rows = db.prepare("SELECT *, event_type as type FROM events ORDER BY COALESCE(starts_at_utc, date || 'T' || COALESCE(time, '00:00') || ':00') ASC, date ASC, time ASC").all();
  for (const ev of rows) {
    ev.speakers = db.prepare(`
      SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
      FROM speakers s
      LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
      WHERE s.event_id = ?
      ORDER BY votes DESC, s.created_at ASC
    `).all(ev.id);
    ev.rsvps = db.prepare(`
      SELECT r.id, r.name, r.user_id, u.avatar
      FROM rsvps r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.event_id = ?
      ORDER BY r.created_at ASC
      LIMIT 5
    `).all(ev.id);
    ev.rsvp_count = db.prepare('SELECT COUNT(*) as c FROM rsvps WHERE event_id = ?').get(ev.id)?.c || 0;
    const resultSummary = getStoredEventResults(ev.id);
    ev.result_summary = resultSummary ? {
      id: resultSummary.id,
      created_at: resultSummary.created_at,
      winner_name: resultSummary.winner_name,
      winner_project_title: resultSummary.winner_project_title,
      total_votes: Number(resultSummary.total_votes || 0),
      total_zaps: Number(resultSummary.total_zaps || 0),
    } : null;
  }
  res.json(rows);
});

app.post('/api/events', requireAuth, (req, res) => {
  const { name, description, event_type, date, time, end_time, event_timezone, location, virtual_link } = req.body;
  const eventType = event_type || req.body.type || 'demo-day';
  const eventTimezone = normalizeEventTimezone(event_timezone || req.body.eventTimezone || 'UTC');
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!date) return res.status(400).json({ error: 'date required' });
  if (!time) return res.status(400).json({ error: 'time required' });
  const startsAtUtc = resolveEventStartUtc(date, time, eventTimezone);
  const endsAtUtc = end_time ? resolveEventStartUtc(date, end_time, eventTimezone) : null;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, end_time, event_timezone, starts_at_utc, ends_at_utc, location, virtual_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name.trim(), description || null,
    eventType, date, time || null,
    end_time || null, eventTimezone, startsAtUtc, endsAtUtc,
    location || null, virtual_link || req.body.virtualLink || null
  );
  res.json({ id });
});

app.put('/api/events/:id', requireAuth, (req, res) => {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin access required' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const { name, description, event_type, date, time, end_time, event_timezone, location, virtual_link } = req.body;
  const eventType = event_type || req.body.type || 'demo-day';
  const eventTimezone = normalizeEventTimezone(event_timezone || req.body.eventTimezone || 'UTC');
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!date) return res.status(400).json({ error: 'date required' });
  if (!time) return res.status(400).json({ error: 'time required' });
  const startsAtUtc = resolveEventStartUtc(date, time, eventTimezone);
  const endsAtUtc = end_time ? resolveEventStartUtc(date, end_time, eventTimezone) : null;
  db.prepare(`UPDATE events
    SET name = ?, description = ?, event_type = ?, date = ?, time = ?, end_time = ?, event_timezone = ?, starts_at_utc = ?, ends_at_utc = ?, location = ?, virtual_link = ?
    WHERE id = ?`).run(
      name.trim(),
      description || null,
      eventType,
      date,
      time,
      end_time || null,
      eventTimezone,
      startsAtUtc,
      endsAtUtc,
      location || null,
      virtual_link || req.body.virtualLink || null,
      req.params.id
    );
  res.json({ ok: true });
});

// Admin: delete event
app.delete('/api/events/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM speakers WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rsvps WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Admin: delete bounty
app.delete('/api/bounties/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM bounty_participants WHERE bounty_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bounties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/bounties/:id/winner — winner info (public)
app.get('/api/bounties/:id/winner', (req, res) => {
  const bounty = db.prepare('SELECT winner_id, winner_name, paid_out FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Not found' });
  if (!bounty.winner_id) return res.json({ winner: null });
  const winner = db.prepare('SELECT id, name, lightning_address FROM users WHERE id = ?').get(bounty.winner_id);
  res.json({ winner_id: bounty.winner_id, winner_name: bounty.winner_name, paid_out: bounty.paid_out, lightning_address: winner ? winner.lightning_address : null });
});

// POST /api/bounties/:id/approve-winner — admin sets winner, status → claimed
app.post('/api/bounties/:id/approve-winner', requireAuth, requireAdmin, (req, res) => {
  const { winner_id, winner_name } = req.body;
  if (!winner_id || !winner_name) return res.status(400).json({ error: 'winner_id and winner_name required' });
  const bounty = db.prepare('SELECT id FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE bounties SET winner_id = ?, winner_name = ?, status = 'claimed' WHERE id = ?").run(winner_id, winner_name, req.params.id);
  checkAndAwardBadges(winner_id);
  res.json({ ok: true });
});

// POST /api/bounties/:id/mark-paid — admin marks payout done, status → completed
app.post('/api/bounties/:id/mark-paid', requireAuth, requireAdmin, (req, res) => {
  const bounty = db.prepare('SELECT id FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE bounties SET paid_out = 1, status = 'completed' WHERE id = ?").run(req.params.id);
  const paidBounty = db.prepare('SELECT winner_id FROM bounties WHERE id = ?').get(req.params.id);
  if (paidBounty?.winner_id) checkAndAwardBadges(paidBounty.winner_id);
  res.json({ ok: true });
});

// GET /api/config/lightning — public Lightning config
app.get('/api/config/lightning', (req, res) => {
  res.json({ admin_ln_address: ADMIN_LN_ADDRESS });
});

// GET /api/admin/forwards — admin: all confirmed zaps with forwarding status
app.get('/api/admin/forwards', requireAuth, requireAdmin, (req, res) => {
  const zaps = db.prepare(`
    SELECT z.id as zap_id,
           p.name as project_name,
           z.user_name as builder,
           u.name as builder_display_name,
           u.avatar as builder_avatar,
           z.amount_sats,
           z.recipient_address,
           z.forward_status,
           z.forward_payment_hash,
           z.created_at
    FROM zaps z
    LEFT JOIN projects p ON z.target_id = p.id AND z.target_type = 'project'
    LEFT JOIN users u ON z.user_id = u.id
    WHERE z.status = 'confirmed'
    ORDER BY z.created_at DESC
    LIMIT 200
  `).all();
  res.json(zaps);
});

/// GET /api/admin/payments-summary — admin: sats totals
app.get('/api/admin/payments-summary', requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare(`SELECT COALESCE(SUM(amount_sats),0) as total FROM zaps WHERE status='confirmed'`).get();
  const fwd = db.prepare(`SELECT COALESCE(SUM(amount_sats),0) as total FROM zaps WHERE status='confirmed' AND forward_status='forwarded'`).get();
  const pend = db.prepare(`SELECT COUNT(*) as cnt FROM zaps WHERE status='confirmed' AND (forward_status IS NULL OR forward_status='pending')`).get();
  const fail = db.prepare(`SELECT COUNT(*) as cnt FROM zaps WHERE status='confirmed' AND forward_status='failed'`).get();
  const pendSats = db.prepare(`SELECT COALESCE(SUM(amount_sats),0) as total FROM zaps WHERE status='confirmed' AND (forward_status IS NULL OR forward_status='pending')`).get();
  const bountyFunded = db.prepare(`SELECT COALESCE(SUM(amount_sats),0) as total FROM bounty_payments WHERE status='confirmed' AND payment_type='fund'`).get();
  res.json({
    total_received: r.total,
    total_forwarded: fwd.total,
    total_pending: pendSats.total,
    total_bounty_funded: bountyFunded.total,
    pending_forwards: pend.cnt,
    failed_forwards: fail.cnt,
  });
});

// POST /api/admin/forwards/:zap_id/retry — retry a failed forward
app.post('/api/admin/forwards/:zap_id/retry', requireAuth, requireAdmin, async (req, res) => {
  const zap = db.prepare('SELECT * FROM zaps WHERE id = ?').get(req.params.zap_id);
  if (!zap) return res.status(404).json({ error: 'Zap not found' });
  if (zap.status !== 'confirmed') return res.status(400).json({ error: 'Zap not confirmed' });
  if (!zap.recipient_address) return res.status(400).json({ error: 'No recipient address' });
  db.prepare(`UPDATE zaps SET forward_status = NULL WHERE id = ?`).run(zap.id);
  const freshZap = db.prepare('SELECT * FROM zaps WHERE id = ?').get(zap.id);
  autoForwardZap(freshZap).catch(e => console.error('[retry forward]', e.message));
  res.json({ ok: true, message: 'Forward retry initiated' });
});

// ─── Lightning / LNURL API ────────────────────────────────────────────────────

// Helper: resolve a Lightning address → LNURL-pay metadata
async function resolveLnAddress(address) {
  const [user, domain] = address.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning address');
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`LNURL resolve failed: ${res.status}`);
  const data = await res.json();
  if (data.tag !== 'payRequest') throw new Error('Not a payRequest endpoint');
  return data; // { callback, minSendable, maxSendable, metadata, ... }
}

// Helper: fetch invoice from LNURL callback
async function fetchLnInvoice(callback, amountMsats) {
  const url = new URL(callback);
  url.searchParams.set('amount', String(amountMsats));
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Invoice fetch failed: ${res.status}`);
  const data = await res.json();
  if (data.status === 'ERROR') throw new Error(data.reason || 'Invoice error');
  if (!data.pr) throw new Error('No payment_request in response');
  // Extract payment hash from bolt11 (bytes 12+, 32 bytes after tag 1)
  // We store verify_url if provided; otherwise we derive from invoice
  return {
    payment_request: data.pr,
    verify_url: data.verify || null,
  };
}

// Helper: generate themed QR code as data URL
async function makeQrDataUrl(data) {
  return await QRCode.toDataURL(data, {
    width: 320,
    margin: 2,
    color: { dark: '#F2B134', light: '#0d0f1a' },
  });
}

// ─── LNbits Direct API Helpers ────────────────────────────────────────────

async function lnbitsCreateInvoice(amountSats, memo, webhookUrl) {
  if (!LNBITS_INVOICE_KEY) throw new Error('LNBITS_INVOICE_KEY not configured');
  const body = { out: false, amount: amountSats, memo };
  if (webhookUrl) body.webhook = webhookUrl;
  const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': LNBITS_INVOICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`LNbits error: ${res.status}`);
  const data = await res.json();
  return {
    payment_request: data.bolt11 || data.payment_request,
    payment_hash: data.payment_hash,
  };
}

async function lnbitsCheckPayment(paymentHash) {
  if (!LNBITS_INVOICE_KEY) return { paid: false };
  const res = await fetch(`${LNBITS_URL}/api/v1/payments/${paymentHash}`, {
    headers: { 'X-Api-Key': LNBITS_INVOICE_KEY },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return { paid: false };
  const data = await res.json();
  return { paid: !!data.paid, status: data.status };
}

async function lnbitsPayInvoice(bolt11) {
  if (!LNBITS_ADMIN_KEY) throw new Error('LNBITS_ADMIN_KEY not configured');
  const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': LNBITS_ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: true, bolt11 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`LNbits pay error: ${res.status}`);
  const data = await res.json();
  return { payment_hash: data.payment_hash || null };
}

async function autoForwardZap(zap) {
  if (!LNBITS_ADMIN_KEY || !zap.recipient_address) return;
  if (zap.recipient_address === ADMIN_LN_ADDRESS) return;
  if (zap.forward_status === 'completed') return;

  db.prepare(`UPDATE zaps SET forward_status = 'pending' WHERE id = ?`).run(zap.id);
  try {
    const lnData = await resolveLnAddress(zap.recipient_address);
    const msats = zap.amount_sats * 1000;
    const inv = await fetchLnInvoice(lnData.callback, msats);
    const result = await lnbitsPayInvoice(inv.payment_request);
    db.prepare(`UPDATE zaps SET forward_status = 'completed', forward_payment_hash = ? WHERE id = ?`)
      .run(result.payment_hash, zap.id);
    console.log(`[autoForward] Zap ${zap.id} forwarded to ${zap.recipient_address}`);
  } catch (e) {
    console.error(`[autoForward] Failed zap ${zap.id}: ${e.message}`);
    db.prepare(`UPDATE zaps SET forward_status = 'failed' WHERE id = ?`).run(zap.id);
  }
}

// POST /api/lightning/resolve — server-side LNURL resolution (avoids CORS)
app.post('/api/lightning/resolve', async (req, res) => {
  const { lightning_address } = req.body;
  if (!lightning_address) return res.status(400).json({ error: 'lightning_address required' });
  try {
    const data = await resolveLnAddress(lightning_address.trim());
    res.json({
      callback: data.callback,
      minSendable: data.minSendable,
      maxSendable: data.maxSendable,
      metadata: data.metadata,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/lightning/invoice — resolve LN address + get invoice
app.post('/api/lightning/invoice', async (req, res) => {
  const { lightning_address, amount_sats } = req.body;
  if (!lightning_address || !amount_sats) return res.status(400).json({ error: 'lightning_address and amount_sats required' });
  const sats = parseInt(amount_sats);
  if (!sats || sats < 1) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const lnData = await resolveLnAddress(lightning_address.trim());
    const msats = sats * 1000;
    if (msats < lnData.minSendable) return res.status(400).json({ error: `Amount too small (min ${lnData.minSendable / 1000} sats)` });
    if (msats > lnData.maxSendable) return res.status(400).json({ error: `Amount too large (max ${lnData.maxSendable / 1000} sats)` });
    const inv = await fetchLnInvoice(lnData.callback, msats);
    res.json({ payment_request: inv.payment_request, verify_url: inv.verify_url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/bounties/:id/fund — generate invoice to fund this bounty
app.post('/api/bounties/:id/fund', requireAuth, async (req, res) => {
  const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum (10M sats)' });
  try {
    // Use LNbits API directly for reliable invoice creation + verification
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const inv = await lnbitsCreateInvoice(amount_sats, `Bounty prize pool: ${bounty.title}`, webhookUrl);
    const paymentId = crypto.randomUUID();
    db.prepare(`INSERT INTO bounty_payments (id, bounty_id, user_id, user_name, amount_sats, payment_type, payment_request, payment_hash, verify_url, status)
      VALUES (?, ?, ?, ?, ?, 'fund', ?, ?, NULL, 'pending')`).run(
      paymentId, bounty.id,
      req.user.id, req.user.name || req.user.email,
      amount_sats, inv.payment_request, inv.payment_hash
    );
    const qrData = 'lightning:' + inv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({
      payment_id: paymentId,
      payment_request: inv.payment_request,
      payment_hash: inv.payment_hash,
      qr_data: qrData,
      qr_data_url,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/bounties/:id/payments — all payments for this bounty
app.get('/api/bounties/:id/payments', (req, res) => {
  const payments = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, payment_type, status, created_at, confirmed_at
     FROM bounty_payments WHERE bounty_id = ? ORDER BY created_at DESC`
  ).all(req.params.id);
  res.json(payments);
});

// GET /api/lightning/verify/:payment_id — check payment via LNbits API
app.get('/api/lightning/verify/:payment_id', async (req, res) => {
  const payment = db.prepare('SELECT * FROM bounty_payments WHERE id = ?').get(req.params.payment_id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'confirmed') return res.json({ settled: true, amount_sats: payment.amount_sats });
  try {
    // Try LNbits API first (using payment_hash)
    let paid = false;
    if (payment.payment_hash && LNBITS_INVOICE_KEY) {
      const check = await lnbitsCheckPayment(payment.payment_hash);
      paid = check.paid;
    } else if (payment.verify_url) {
      // Fallback to verify URL for non-LNbits invoices
      const vRes = await fetch(payment.verify_url, { signal: AbortSignal.timeout(6000) });
      if (vRes.ok) { const vData = await vRes.json(); paid = !!vData.settled; }
    } else {
      return res.json({ settled: false, amount_sats: payment.amount_sats, no_verify: true });
    }
    if (paid) {
      db.prepare(`UPDATE bounty_payments SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(payment.id);
      if (payment.payment_type === 'fund') {
        db.prepare(`UPDATE bounties SET funded_amount = funded_amount + ? WHERE id = ?`).run(payment.amount_sats, payment.bounty_id);
        if (payment.user_id) cachedBadgeCheck(payment.user_id);
      } else if (payment.payment_type === 'payout') {
        db.prepare(`UPDATE bounties SET paid_out = 1, status = 'completed' WHERE id = ?`).run(payment.bounty_id);
        const b = db.prepare('SELECT winner_id FROM bounties WHERE id = ?').get(payment.bounty_id);
        if (b?.winner_id) checkAndAwardBadges(b.winner_id);
      }
      return res.json({ settled: true, amount_sats: payment.amount_sats });
    }
    res.json({ settled: false, amount_sats: payment.amount_sats });
  } catch (e) {
    res.json({ settled: false, amount_sats: payment.amount_sats, error: e.message });
  }
});

// POST /api/bounties/:id/pay-winner — admin: generate invoice to pay winner
app.post('/api/bounties/:id/pay-winner', requireAuth, requireAdmin, async (req, res) => {
  const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  if (!bounty.winner_id) return res.status(400).json({ error: 'No winner set' });
  const winner = db.prepare('SELECT id, name, lightning_address FROM users WHERE id = ?').get(bounty.winner_id);
  if (!winner?.lightning_address) return res.status(400).json({ error: 'Winner has no Lightning address set' });
  const fundedSats = Number(bounty.funded_amount || 0);
  const payoutTotal = Number(bounty.sats_amount || 0) + fundedSats;
  const amount_sats = parseInt(req.body.amount_sats) || payoutTotal;
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'Invalid payout amount' });
  try {
    const lnData = await resolveLnAddress(winner.lightning_address);
    const msats = amount_sats * 1000;
    if (msats < lnData.minSendable) return res.status(400).json({ error: `Amount too small for winner's wallet (min ${lnData.minSendable / 1000} sats)` });
    if (msats > lnData.maxSendable) return res.status(400).json({ error: `Amount too large for winner's wallet (max ${lnData.maxSendable / 1000} sats)` });
    const inv = await fetchLnInvoice(lnData.callback, msats);
    const paymentId = crypto.randomUUID();
    db.prepare(`INSERT INTO bounty_payments (id, bounty_id, user_id, user_name, amount_sats, payment_type, payment_request, verify_url, status)
      VALUES (?, ?, ?, ?, ?, 'payout', ?, ?, 'pending')`).run(
      paymentId, bounty.id,
      winner.id, winner.name,
      amount_sats, inv.payment_request, inv.verify_url
    );
    const qrData = 'lightning:' + inv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({
      payment_id: paymentId,
      payment_request: inv.payment_request,
      verify_url: inv.verify_url,
      qr_data: qrData,
      qr_data_url,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// TODO: Add rate limiting to profile mutation endpoints (e.g. express-rate-limit)

// Validation helpers
function isValidUrl(str) {
  if (!str) return true; // empty is allowed
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

const LN_ADDRESS_RE = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// PUT /api/profile/lightning — save own Lightning address
app.put('/api/profile/lightning', requireAuth, (req, res) => {
  const raw = typeof req.body.lightning_address === 'string' ? req.body.lightning_address.trim() : '';
  if (raw && !LN_ADDRESS_RE.test(raw)) {
    return res.status(400).json({ error: 'Invalid Lightning address format' });
  }
  db.prepare('UPDATE users SET lightning_address = ? WHERE id = ?').run(raw || null, req.user.id);
  res.json({ ok: true });
});

// PUT /api/profile — update bio, website_url, github_url, banner preset
app.put('/api/profile', requireAuth, (req, res) => {
  const { bio, website_url, github_url, banner_preset } = req.body;
  const b = typeof bio === 'string' ? bio.trim().slice(0, 160) : null;
  const w = typeof website_url === 'string' ? website_url.trim().slice(0, 512) : null;
  const g = typeof github_url === 'string' ? github_url.trim().slice(0, 512) : null;
  const allowedBannerPresets = new Set(['lunar-dawn', 'saturn-violet', 'bitcoin-sunset']);
  const bannerPreset = allowedBannerPresets.has(String(banner_preset || '').trim()) ? String(banner_preset).trim() : null;
  if (w && !isValidUrl(w)) return res.status(400).json({ error: 'website_url must be a valid http/https URL' });
  if (g && !isValidUrl(g)) return res.status(400).json({ error: 'github_url must be a valid http/https URL' });
  db.prepare('UPDATE users SET bio = ?, website_url = ?, github_url = ?, banner_preset = ? WHERE id = ?').run(b || null, w || null, g || null, bannerPreset, req.user.id);
  res.json({ ok: true, banner_preset: bannerPreset });
});

// POST /api/profile/avatar — upload profile photo
app.post('/api/profile/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const filename = req.user.id + ext;
  const destPath = path.join(AVATARS_DIR, filename);
  try {
    fs.renameSync(req.file.path, destPath);
  } catch (_) {
    try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
      return res.status(500).json({ error: 'Failed to save avatar' });
    }
  }
  if (sharp) {
    try {
      const processed = await sharp(destPath).resize(400, 400, { fit: 'cover', position: 'center' }).toBuffer();
      fs.writeFileSync(destPath, processed);
    } catch (_) {}
  }
  const avatarUrl = '/avatars/' + filename;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);
  res.json({ ok: true, avatar: avatarUrl });
});

// POST /api/projects/:id/banner — upload project banner image (max 5MB)
app.post('/api/projects/:id/banner', requireAuth, bannerUpload.single('banner'), async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Not found' }); }
  if (!canManageProject(project, req.user)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const filename = 'proj-banner-' + req.params.id + ext;
  const destPath = path.join(AVATARS_DIR, filename);
  try {
    fs.renameSync(req.file.path, destPath);
  } catch (_) {
    try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
      return res.status(500).json({ error: 'Failed to save banner' });
    }
  }
  if (sharp) {
    try {
      const processed = await sharp(destPath).resize(800, 450, { fit: 'cover', position: 'centre' }).toBuffer();
      fs.writeFileSync(destPath, processed);
    } catch (_) {}
  }
  const bannerUrl = '/avatars/' + filename;
  db.prepare('UPDATE projects SET banner_url = ? WHERE id = ?').run(bannerUrl, req.params.id);
  res.json({ ok: true, banner_url: bannerUrl });
});

// POST /api/projects/:id/thumbnail — upload project thumbnail (max 2MB)
app.post('/api/projects/:id/thumbnail', requireAuth, avatarUpload.single('thumbnail'), async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Not found' }); }
  if (!canManageProject(project, req.user)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const filename = 'proj-thumb-' + req.params.id + ext;
  const destPath = path.join(AVATARS_DIR, filename);
  try {
    fs.renameSync(req.file.path, destPath);
  } catch (_) {
    try { fs.copyFileSync(req.file.path, destPath); fs.unlinkSync(req.file.path); } catch (e) {
      return res.status(500).json({ error: 'Failed to save thumbnail' });
    }
  }
  if (sharp) {
    try {
      const processed = await sharp(destPath).resize(200, 200, { fit: 'cover', position: 'centre' }).toBuffer();
      fs.writeFileSync(destPath, processed);
    } catch (_) {}
  }
  const thumbnailUrl = '/avatars/' + filename;
  db.prepare('UPDATE projects SET thumbnail_url = ? WHERE id = ?').run(thumbnailUrl, req.params.id);
  res.json({ ok: true, thumbnail_url: thumbnailUrl });
});

// POST /api/projects/:id/zap — generate invoice to zap this project's builder
app.post('/api/projects/:id/zap', requireAuth, async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum (10M sats)' });

  // Resolve builder's Lightning address for later auto-forwarding
  let recipientAddress = null;
  let recipient = project.builder;

  if (project.user_id) {
    const builder = db.prepare('SELECT name, lightning_address FROM users WHERE id = ?').get(project.user_id);
    if (builder?.lightning_address) {
      recipientAddress = builder.lightning_address;
      recipient = builder.name || project.builder;
    }
  }
  // Fallback: match by builder name
  if (!recipientAddress && project.builder) {
    const builder = db.prepare("SELECT name, lightning_address FROM users WHERE name = ? AND lightning_address IS NOT NULL LIMIT 1").get(project.builder);
    if (builder?.lightning_address) {
      recipientAddress = builder.lightning_address;
      recipient = builder.name || project.builder;
    }
  }

  try {
    // ALL zaps route through LNbits for reliable verification, then auto-forward to builder
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const lnbitsInv = await lnbitsCreateInvoice(amount_sats, `Zap: ${project.name} by ${project.builder}`, webhookUrl);
    const zapId = crypto.randomUUID();
    db.prepare(`INSERT INTO zaps (id, target_type, target_id, user_id, user_name, amount_sats, payment_request, payment_hash, verify_url, status, recipient_address)
      VALUES (?, 'project', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`).run(
      zapId, project.id,
      req.user.id, req.user.name || req.user.email,
      amount_sats, lnbitsInv.payment_request, lnbitsInv.payment_hash, recipientAddress
    );
    const qrData = 'lightning:' + lnbitsInv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({ zap_id: zapId, payment_request: lnbitsInv.payment_request, qr_data_url, recipient });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/projects/:id/zaps — confirmed zaps for this project
app.get('/api/projects/:id/zaps', (req, res) => {
  const zaps = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, created_at
     FROM zaps WHERE target_type = 'project' AND target_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 20`
  ).all(req.params.id);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE target_type = 'project' AND target_id = ? AND status = 'confirmed'`
  ).get(req.params.id);
  res.json({ zaps, total_sats: row?.total || 0 });
});

// POST /api/decks/:id/zap — generate invoice to zap this deck's uploader
app.post('/api/decks/:id/zap', requireAuth, async (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum (10M sats)' });

  let recipientAddress = null;
  let recipient = deck.author;

  if (deck.uploaded_by) {
    const uploader = db.prepare('SELECT name, lightning_address FROM users WHERE id = ?').get(deck.uploaded_by);
    if (uploader?.lightning_address) {
      recipientAddress = uploader.lightning_address;
      recipient = uploader.name || deck.author;
    }
  }
  if (!recipientAddress && deck.author) {
    const uploader = db.prepare("SELECT name, lightning_address FROM users WHERE name = ? AND lightning_address IS NOT NULL LIMIT 1").get(deck.author);
    if (uploader?.lightning_address) {
      recipientAddress = uploader.lightning_address;
      recipient = uploader.name || deck.author;
    }
  }

  try {
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const lnbitsInv = await lnbitsCreateInvoice(amount_sats, `Zap: ${deck.title} by ${deck.author}`, webhookUrl);
    const zapId = crypto.randomUUID();
    db.prepare(`INSERT INTO zaps (id, target_type, target_id, user_id, user_name, amount_sats, payment_request, payment_hash, verify_url, status, recipient_address)
      VALUES (?, 'deck', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`).run(
      zapId, deck.id,
      req.user.id, req.user.name || req.user.email,
      amount_sats, lnbitsInv.payment_request, lnbitsInv.payment_hash, recipientAddress
    );
    const qrData = 'lightning:' + lnbitsInv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({ zap_id: zapId, payment_request: lnbitsInv.payment_request, qr_data_url, recipient });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/decks/:id/zaps — confirmed zaps for this deck
app.get('/api/decks/:id/zaps', (req, res) => {
  const zaps = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, created_at
     FROM zaps WHERE target_type = 'deck' AND target_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 20`
  ).all(req.params.id);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE target_type = 'deck' AND target_id = ? AND status = 'confirmed'`
  ).get(req.params.id);
  res.json({ zaps, total_sats: row?.total || 0 });
});

// POST /api/speakers/:id/zap — generate invoice to zap this presenter
app.post('/api/speakers/:id/zap', requireAuth, async (req, res) => {
  const speaker = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum (10M sats)' });

  let recipientAddress = null;
  let recipient = speaker.name;

  if (speaker.user_id) {
    const presenter = db.prepare('SELECT name, lightning_address FROM users WHERE id = ?').get(speaker.user_id);
    if (presenter?.lightning_address) {
      recipientAddress = presenter.lightning_address;
      recipient = presenter.name || speaker.name;
    }
  }
  if (!recipientAddress && speaker.name) {
    const presenter = db.prepare("SELECT name, lightning_address FROM users WHERE name = ? AND lightning_address IS NOT NULL LIMIT 1").get(speaker.name);
    if (presenter?.lightning_address) {
      recipientAddress = presenter.lightning_address;
      recipient = presenter.name || speaker.name;
    }
  }

  try {
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const lnbitsInv = await lnbitsCreateInvoice(amount_sats, `Zap: ${speaker.project_title} by ${speaker.name}`, webhookUrl);
    const zapId = crypto.randomUUID();
    db.prepare(`INSERT INTO zaps (id, target_type, target_id, user_id, user_name, amount_sats, payment_request, payment_hash, verify_url, status, recipient_address)
      VALUES (?, 'speaker', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`).run(
      zapId, speaker.id,
      req.user.id, req.user.name || req.user.email,
      amount_sats, lnbitsInv.payment_request, lnbitsInv.payment_hash, recipientAddress
    );
    const qrData = 'lightning:' + lnbitsInv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({ zap_id: zapId, payment_request: lnbitsInv.payment_request, qr_data_url, recipient });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/speakers/:id/zaps — confirmed zaps for this speaker
app.get('/api/speakers/:id/zaps', (req, res) => {
  const zaps = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, created_at
     FROM zaps WHERE target_type = 'speaker' AND target_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 20`
  ).all(req.params.id);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE target_type = 'speaker' AND target_id = ? AND status = 'confirmed'`
  ).get(req.params.id);
  res.json({ zaps, total_sats: row?.total || 0 });
});

// GET /api/zaps/verify/:zap_id — check payment via LNbits API or verify URL
app.get('/api/zaps/verify/:zap_id', async (req, res) => {
  const zap = db.prepare('SELECT * FROM zaps WHERE id = ?').get(req.params.zap_id);
  if (!zap) return res.status(404).json({ error: 'Zap not found' });
  if (zap.status === 'confirmed') return res.json({ settled: true, amount_sats: zap.amount_sats });
  try {
    let paid = false;
    if (zap.payment_hash && LNBITS_INVOICE_KEY) {
      const check = await lnbitsCheckPayment(zap.payment_hash);
      paid = check.paid;
    } else if (zap.verify_url) {
      const vRes = await fetch(zap.verify_url, { signal: AbortSignal.timeout(6000) });
      if (vRes.ok) { const vData = await vRes.json(); paid = !!vData.settled; }
    } else {
      return res.json({ settled: false, amount_sats: zap.amount_sats, no_verify: true });
    }
    if (paid) {
      db.prepare(`UPDATE zaps SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(zap.id);
      const zapperName = zap.user_name || 'Someone';
      if (zap.target_type === 'deck') {
        db.prepare(`UPDATE decks SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const deck = db.prepare('SELECT uploaded_by, title FROM decks WHERE id = ?').get(zap.target_id);
        if (deck?.uploaded_by) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, deck.uploaded_by);
          notify(deck.uploaded_by, 'zap', zap.user_id, zapperName, 'deck', zap.target_id, deck.title);
        }
      } else if (zap.target_type === 'project') {
        db.prepare(`UPDATE projects SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const project = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(zap.target_id);
        if (project?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, project.user_id);
          notify(project.user_id, 'zap', zap.user_id, zapperName, 'project', zap.target_id, project.name);
        }
      } else if (zap.target_type === 'idea') {
        db.prepare(`UPDATE ideas SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const idea = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(zap.target_id);
        if (idea?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, idea.user_id);
          notify(idea.user_id, 'zap', zap.user_id, zapperName, 'idea', zap.target_id, idea.title);
        }
      } else if (zap.target_type === 'speaker') {
        const speaker = db.prepare('SELECT user_id, name, project_title FROM speakers WHERE id = ?').get(zap.target_id);
        if (speaker?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, speaker.user_id);
          notify(speaker.user_id, 'zap', zap.user_id, zapperName, 'speaker', zap.target_id, speaker.project_title || speaker.name);
        }
      }
      if (zap.user_id) cachedBadgeCheck(zap.user_id);
      autoForwardZap(zap).catch(e => console.error('[verify autoForward]', e.message));
      return res.json({ settled: true, amount_sats: zap.amount_sats });
    }
    res.json({ settled: false, amount_sats: zap.amount_sats });
  } catch (e) {
    res.json({ settled: false, amount_sats: zap.amount_sats, error: e.message });
  }
});

// POST /api/lightning/confirm/:payment_id — manually confirm payment (when no verify URL)
app.post('/api/lightning/confirm/:payment_id', requireAuth, (req, res) => {
  const payment = db.prepare('SELECT * FROM bounty_payments WHERE id = ?').get(req.params.payment_id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'confirmed') return res.json({ settled: true, amount_sats: payment.amount_sats });
  // Only the payer or admin can confirm
  if (payment.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Not authorized' });
  db.prepare(`UPDATE bounty_payments SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(payment.id);
  if (payment.payment_type === 'fund') {
    db.prepare(`UPDATE bounties SET funded_amount = funded_amount + ? WHERE id = ?`).run(payment.amount_sats, payment.bounty_id);
    if (payment.user_id) cachedBadgeCheck(payment.user_id);
  } else if (payment.payment_type === 'payout') {
    db.prepare(`UPDATE bounties SET paid_out = 1, status = 'completed' WHERE id = ?`).run(payment.bounty_id);
    const b = db.prepare('SELECT winner_id FROM bounties WHERE id = ?').get(payment.bounty_id);
    if (b?.winner_id) checkAndAwardBadges(b.winner_id);
  }
  res.json({ settled: true, amount_sats: payment.amount_sats });
});

// POST /api/zaps/confirm/:zap_id — manually confirm zap (when no verify URL)
app.post('/api/zaps/confirm/:zap_id', requireAuth, (req, res) => {
  const zap = db.prepare('SELECT * FROM zaps WHERE id = ?').get(req.params.zap_id);
  if (!zap) return res.status(404).json({ error: 'Zap not found' });
  if (zap.status === 'confirmed') return res.json({ settled: true, amount_sats: zap.amount_sats });
  if (zap.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Not authorized' });
  db.prepare(`UPDATE zaps SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(zap.id);
  const zapperName = zap.user_name || 'Someone';
  if (zap.target_type === 'deck') {
    db.prepare(`UPDATE decks SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
    const deck = db.prepare('SELECT uploaded_by, title FROM decks WHERE id = ?').get(zap.target_id);
    if (deck?.uploaded_by) {
      db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, deck.uploaded_by);
      notify(deck.uploaded_by, 'zap', zap.user_id, zapperName, 'deck', zap.target_id, deck.title);
    }
  } else if (zap.target_type === 'project') {
    db.prepare(`UPDATE projects SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
    const project = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(zap.target_id);
    if (project?.user_id) {
      db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, project.user_id);
      notify(project.user_id, 'zap', zap.user_id, zapperName, 'project', zap.target_id, project.name);
    }
  } else if (zap.target_type === 'idea') {
    db.prepare(`UPDATE ideas SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
    const idea = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(zap.target_id);
    if (idea?.user_id) {
      db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, idea.user_id);
      notify(idea.user_id, 'zap', zap.user_id, zapperName, 'idea', zap.target_id, idea.title);
    }
  } else if (zap.target_type === 'speaker') {
    const speaker = db.prepare('SELECT user_id, name, project_title FROM speakers WHERE id = ?').get(zap.target_id);
    if (speaker?.user_id) {
      db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, speaker.user_id);
      notify(speaker.user_id, 'zap', zap.user_id, zapperName, 'speaker', zap.target_id, speaker.project_title || speaker.name);
    }
  }
  if (zap.user_id) cachedBadgeCheck(zap.user_id);
  autoForwardZap(zap).catch(e => console.error('[confirm autoForward]', e.message));
  res.json({ settled: true, amount_sats: zap.amount_sats });
});

// POST /api/webhook/lnbits — instant payment confirmation pushed by LNbits
app.post('/api/webhook/lnbits', async (req, res) => {
  if (LNBITS_WEBHOOK_SECRET) {
    const provided = req.headers['x-api-key'] || req.body?.webhook_secret;
    if (provided !== LNBITS_WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  }

  const payment_hash = req.body?.payment_hash;
  if (!payment_hash) return res.status(400).json({ error: 'payment_hash required' });

  // Try zaps first
  const zap = db.prepare('SELECT * FROM zaps WHERE payment_hash = ?').get(payment_hash);
  if (zap) {
    if (zap.status !== 'confirmed') {
      db.prepare(`UPDATE zaps SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(zap.id);
      const zapperName = zap.user_name || 'Someone';
      if (zap.target_type === 'deck') {
        db.prepare(`UPDATE decks SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const deck = db.prepare('SELECT uploaded_by, title FROM decks WHERE id = ?').get(zap.target_id);
        if (deck?.uploaded_by) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, deck.uploaded_by);
          notify(deck.uploaded_by, 'zap', zap.user_id, zapperName, 'deck', zap.target_id, deck.title);
        }
      } else if (zap.target_type === 'project') {
        db.prepare(`UPDATE projects SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const project = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(zap.target_id);
        if (project?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, project.user_id);
          notify(project.user_id, 'zap', zap.user_id, zapperName, 'project', zap.target_id, project.name);
        }
      } else if (zap.target_type === 'idea') {
        db.prepare(`UPDATE ideas SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const idea = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(zap.target_id);
        if (idea?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, idea.user_id);
          notify(idea.user_id, 'zap', zap.user_id, zapperName, 'idea', zap.target_id, idea.title);
        }
      } else if (zap.target_type === 'speaker') {
        const speaker = db.prepare('SELECT user_id, name, project_title FROM speakers WHERE id = ?').get(zap.target_id);
        if (speaker?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, speaker.user_id);
          notify(speaker.user_id, 'zap', zap.user_id, zapperName, 'speaker', zap.target_id, speaker.project_title || speaker.name);
        }
      }
      if (zap.user_id) cachedBadgeCheck(zap.user_id);
      autoForwardZap(zap).catch(e => console.error('[webhook autoForward]', e.message));
    }
    return res.json({ ok: true, type: 'zap', zap_id: zap.id });
  }

  // Try bounty payments
  const payment = db.prepare('SELECT * FROM bounty_payments WHERE payment_hash = ?').get(payment_hash);
  if (payment) {
    if (payment.status !== 'confirmed') {
      db.prepare(`UPDATE bounty_payments SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(payment.id);
      if (payment.payment_type === 'fund') {
        db.prepare(`UPDATE bounties SET funded_amount = funded_amount + ? WHERE id = ?`).run(payment.amount_sats, payment.bounty_id);
        if (payment.user_id) cachedBadgeCheck(payment.user_id);
      } else if (payment.payment_type === 'payout') {
        db.prepare(`UPDATE bounties SET paid_out = 1, status = 'completed' WHERE id = ?`).run(payment.bounty_id);
        const b = db.prepare('SELECT winner_id FROM bounties WHERE id = ?').get(payment.bounty_id);
        if (b?.winner_id) checkAndAwardBadges(b.winner_id);
      }
    }
    return res.json({ ok: true, type: 'bounty_payment', payment_id: payment.id });
  }

  res.json({ ok: true, type: 'no_op' });
});

// Delete project (owner or admin)
app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!canManageProject(p, req.user)) return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM comments WHERE deck_id = ?').run(req.params.id); // reuse comments table
  db.prepare('DELETE FROM votes WHERE target_type = ? AND target_id = ?').run('project', req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Delete speaker (own registration or admin)
app.delete('/api/speakers/:id', requireAuth, (req, res) => {
  const speaker = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  if (speaker.user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'Not your registration' });
  }
  stmts.deleteVotes.run('speaker', req.params.id);
  db.prepare('DELETE FROM speakers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/events/:id', (req, res) => {
  const event = db.prepare('SELECT *, event_type as type FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const livePayload = getLiveSessionPayload(req.params.id);
  const eventResults = getStoredEventResults(req.params.id);
  const speakers = livePayload?.speakers?.length
    ? livePayload.speakers.slice().sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0) || Number(a.queue_position || 2147483647) - Number(b.queue_position || 2147483647))
    : db.prepare(`
      SELECT s.*, s.project_title as project, COALESCE(v.vote_count, 0) as votes
      FROM speakers s
      LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
      WHERE s.event_id = ?
      ORDER BY votes DESC, s.created_at ASC
    `).all(req.params.id);
  const live_summary = livePayload?.session ? {
    status: livePayload.session.status,
    payout_status: livePayload.session.payout_status,
    winner_confirmed_at: livePayload.session.winner_confirmed_at || null,
    winner: livePayload.winner || null,
    winner_recommendation: livePayload.winner_recommendation || null,
    results_url: livePayload.results_url || null,
  } : null;
  const result_summary = eventResults ? {
    id: eventResults.id,
    created_at: eventResults.created_at,
    winner_name: eventResults.winner_name,
    winner_project_title: eventResults.winner_project_title,
    total_votes: Number(eventResults.total_votes || 0),
    total_zaps: Number(eventResults.total_zaps || 0),
  } : null;
  res.json({
    ...event,
    speakers,
    live_summary,
    result_summary,
    event_results: eventResults?.results || null,
  });
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
  const event = db.prepare('SELECT id, virtual_link FROM events WHERE id = ?').get(eid);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const id = crypto.randomUUID();
  const nextQueuePosition = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) + 1 as next_pos FROM speakers WHERE event_id = ?').get(eid)?.next_pos) || 1;
  db.prepare(`INSERT INTO speakers (id, event_id, name, project_title, description, duration, github_url, demo_url, deck_id, user_id, scheduled_at, status, queue_position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'scheduled', ?)`).run(
    id, eid, name.trim(), ptitle.trim(),
    description || null, parseInt(duration) || 10,
    github_url || null, demo_url || null, deck_id || null, req.user?.id || null, nextQueuePosition
  );
  res.json({ id });
});

app.post('/api/speakers/:id/presented', requireAuth, requireAdmin, (req, res) => {
  const speaker = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  db.prepare(`
    UPDATE speakers
    SET presented_at = COALESCE(presented_at, datetime('now')),
        status = 'presented'
    WHERE id = ?
  `).run(req.params.id);
  if (speaker.user_id) checkAndAwardBadges(speaker.user_id);
  res.json({ ok: true });
});

app.delete('/api/speakers/:id/presented', requireAuth, requireAdmin, (req, res) => {
  const speaker = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  db.prepare("UPDATE speakers SET presented_at = NULL, status = 'scheduled' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
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

app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const name = req.user.name || req.user.email || 'Anonymous';
  const email = req.user.email || null;
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const existing = normalizedEmail
    ? db.prepare(`SELECT id, user_id FROM rsvps WHERE event_id = ? AND (user_id = ? OR lower(email) = ?) ORDER BY created_at ASC`).get(req.params.id, req.user.id, normalizedEmail)
    : db.prepare('SELECT id, user_id FROM rsvps WHERE event_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) {
    if (!existing.user_id) {
      db.prepare('UPDATE rsvps SET user_id = ?, name = ?, email = ? WHERE id = ?').run(req.user.id, name, email, existing.id);
      if (normalizedEmail) {
        db.prepare('DELETE FROM rsvps WHERE event_id = ? AND id <> ? AND (user_id = ? OR lower(email) = ?)').run(req.params.id, existing.id, req.user.id, normalizedEmail);
      }
    }
    return res.status(409).json({ error: 'Already RSVP\'d' });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO rsvps (id, event_id, name, email, user_id) VALUES (?, ?, ?, ?, ?)').run(
    id, req.params.id, name, email, req.user.id
  );
  res.json({ id });
});

app.delete('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Not RSVP\'d' });
  res.json({ ok: true });
});

app.get('/api/events/:id/rsvps', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.avatar, u.id as profile_user_id, u.username, u.name as profile_name
    FROM rsvps r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.event_id = ?
    ORDER BY r.created_at ASC
  `).all(req.params.id);
  const user_rsvp = req.user ? !!db.prepare('SELECT 1 FROM rsvps WHERE event_id = ? AND user_id = ?').get(req.params.id, req.user.id) : false;
  res.json({ rsvps: rows, count: rows.length, user_rsvp });
});

// ─── Projects API ─────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  const { bounty_id } = req.query;
  let query = `
    SELECT p.*, COALESCE(v.vote_count, 0) as votes, b.title as bounty_title
    FROM projects p
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'project' GROUP BY target_id) v ON p.id = v.target_id
    LEFT JOIN bounties b ON p.bounty_id = b.id
  `;
  const params = [];
  if (bounty_id) {
    query += ` WHERE p.bounty_id = ?`;
    params.push(bounty_id);
  }
  query += ` ORDER BY votes DESC, p.created_at DESC`;
  const rows = db.prepare(query).all(...params);
  res.json(filterPublicProjects(rows));
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, builder, description, status, tags, category, bounty_id, repo_url, repo, demo_url, demo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!builder || !builder.trim()) return res.status(400).json({ error: 'builder required' });
  if (isPlaceholderProject({ name, description })) return res.status(400).json({ error: 'Project looks like placeholder content' });
  const id = crypto.randomUUID();
  const slug = uniqueSlug('projects', toSlug(name.trim()));
  const { deck_id } = req.body;
  db.prepare(`INSERT INTO projects (id, name, builder, description, status, tags, category, bounty_id, user_id, deck_id, repo_url, demo_url, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name.trim(), builder.trim(), description || null,
    status || 'building',
    Array.isArray(tags) ? tags.join(',') : (tags || null),
    category || null, bounty_id || null, req.user?.id || null, deck_id || null,
    repo_url || repo || null, demo_url || demo || null, slug
  );
  if (req.user?.id) checkAndAwardBadges(req.user.id);
  res.json({ id, slug });
});

// PUT /api/projects/:id — edit project (owner only)
app.put('/api/projects/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canManageProject(project, req.user)) return res.status(403).json({ error: 'Not your project' });
  const { name, description, status, tags, category, repo_url, demo_url, deck_id } = req.body;
  if (isPlaceholderProject({ name: name !== undefined ? name : project.name, description: description !== undefined ? description : project.description })) {
    return res.status(400).json({ error: 'Project looks like placeholder content' });
  }
  db.prepare(`UPDATE projects SET
    name = COALESCE(?, name), description = COALESCE(?, description),
    status = COALESCE(?, status), tags = COALESCE(?, tags),
    category = COALESCE(?, category), repo_url = ?, demo_url = ?, deck_id = COALESCE(?, deck_id)
    WHERE id = ?`).run(
    name || null, description || null, status || null,
    Array.isArray(tags) ? tags.join(',') : (tags || null),
    category || null, repo_url || null, demo_url || null, deck_id || null,
    req.params.id
  );
  res.json({ ok: true });
});

// PUT /api/decks/:id — edit deck (owner only)
app.put('/api/decks/:id', requireAuth, (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Not found' });
  if (deck.uploaded_by && req.user?.id !== deck.uploaded_by && !req.user?.is_admin) return res.status(403).json({ error: 'Not your deck' });
  const { title, description, tags, github_url, demo_url } = req.body;
  db.prepare(`UPDATE decks SET
    title = COALESCE(?, title), description = COALESCE(?, description),
    tags = COALESCE(?, tags), github_url = ?, demo_url = ?
    WHERE id = ?`).run(
    title || null, description || null, tags || null,
    github_url || null, demo_url || null, req.params.id
  );
  res.json({ ok: true });
});

// GET /api/projects/:id — single project with bounty info
app.get('/api/projects/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, COALESCE(v.vote_count, 0) as votes, b.title as bounty_title,
      d.title as deck_title, d.thumbnail as deck_thumbnail, d.entry_point as deck_entry_point,
      COALESCE(c.comment_count, 0) as comment_count
    FROM projects p
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'project' GROUP BY target_id) v ON p.id = v.target_id
    LEFT JOIN bounties b ON p.bounty_id = b.id
    LEFT JOIN decks d ON p.deck_id = d.id
    LEFT JOIN (SELECT deck_id, COUNT(*) as comment_count FROM comments GROUP BY deck_id) c ON p.id = c.deck_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!row || isPlaceholderProject(row)) return res.status(404).json({ error: 'Not found' });
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
    ORDER BY c.created_at ASC
  `).all(voterId, req.params.id);
  res.json(filterPublicComments(rows));
});

// POST /api/projects/:id/comments
app.post('/api/projects/:id/comments', requireAuth, (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  if (hasBlockedCommentContent(content)) return res.status(400).json({ error: 'Comment violates content rules' });
  if (parent_id) {
    const parent = db.prepare('SELECT id, deck_id, parent_id FROM comments WHERE id = ?').get(parent_id);
    if (!parent || parent.deck_id !== req.params.id) return res.status(400).json({ error: 'Invalid parent comment' });
  }
  const id = crypto.randomUUID();
  const authorName = req.user?.name || 'Anonymous';
  db.prepare('INSERT INTO comments (id, deck_id, user_id, author_name, content, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, req.user?.id || null, authorName, content.trim(), parent_id || null
  );
  const _proj = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(req.params.id);
  if (parent_id) {
    // Reply: notify item owner + thread participants
    const rootId = db.prepare('SELECT COALESCE(parent_id, id) as root FROM comments WHERE id = ?').get(parent_id)?.root || parent_id;
    if (_proj?.user_id) notify(_proj.user_id, 'reply', req.user.id, authorName, 'project', req.params.id, _proj.name);
    const threadUsers = db.prepare('SELECT DISTINCT user_id FROM comments WHERE (id = ? OR parent_id = ?) AND user_id IS NOT NULL AND user_id != ?').all(rootId, rootId, req.user.id);
    for (const u of threadUsers) {
      if (u.user_id !== _proj?.user_id) notify(u.user_id, 'reply', req.user.id, authorName, 'project', req.params.id, _proj?.name);
    }
  } else {
    // Top-level comment: notify item owner only
    if (_proj?.user_id) notify(_proj.user_id, 'comment', req.user.id, authorName, 'project', req.params.id, _proj.name);
  }
  res.json({ id });
});

app.delete('/api/comments/:id', requireAuth, requireAdmin, (req, res) => {
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Not found' });
  const commentIds = db.prepare('SELECT id FROM comments WHERE id = ? OR parent_id = ?').all(req.params.id, req.params.id).map((row) => row.id);
  if (commentIds.length) {
    const placeholders = commentIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM votes WHERE target_type = 'comment' AND target_id IN (${placeholders})`).run(...commentIds);
  }
  db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').run(req.params.id, req.params.id);
  res.json({ ok: true });
});

// ─── Foyer Activity API ───────────────────────────────────────────────────────

// GET /api/foyer/activity — recent high-signal actions in The Foyer
app.get('/api/foyer/activity', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT 'zap' as type, u.name as actor_name, i.title as idea_title, i.id as idea_id,
        z.confirmed_at as ts, z.amount_sats
      FROM zaps z
      JOIN ideas i ON z.target_id = i.id AND z.target_type = 'idea'
      LEFT JOIN users u ON z.user_id = u.id
      WHERE z.status = 'confirmed'

      UNION ALL

      SELECT 'join' as type, u.name as actor_name, i.title as idea_title, i.id as idea_id,
        im.created_at as ts, NULL as amount_sats
      FROM idea_members im
      JOIN ideas i ON im.idea_id = i.id
      LEFT JOIN users u ON im.user_id = u.id

      UNION ALL

      SELECT 'new_idea' as type, u.name as actor_name, i.title as idea_title, i.id as idea_id,
        i.created_at as ts, NULL as amount_sats
      FROM ideas i
      LEFT JOIN users u ON i.user_id = u.id

      UNION ALL

      SELECT 'conversion' as type, u.name as actor_name, i.title as idea_title, i.id as idea_id,
        i.created_at as ts, NULL as amount_sats
      FROM ideas i
      LEFT JOIN users u ON i.user_id = u.id
      WHERE i.converted_to_project_id IS NOT NULL
    )
    ORDER BY ts DESC
    LIMIT 15
  `).all();
  res.json(filterPublicIdeas(rows.map((row) => ({ ...row, title: row.idea_title })) ).map(({ title, ...row }) => row));
});

// GET /api/foyer/top-zappers — top 5 zappers on ideas this week
app.get('/api/foyer/top-zappers', (req, res) => {
  const rows = db.prepare(`
    SELECT z.user_id, z.user_name, u.avatar, SUM(z.amount_sats) as total_sats
    FROM zaps z
    LEFT JOIN users u ON z.user_id = u.id
    WHERE z.target_type = 'idea' AND z.status = 'confirmed'
      AND z.confirmed_at >= datetime('now', '-7 days')
    GROUP BY z.user_id
    ORDER BY total_sats DESC
    LIMIT 5
  `).all();
  res.json(rows);
});

// ─── Ideas API ────────────────────────────────────────────────────────────────

// GET /api/ideas — list ideas with sort/filter
app.get('/api/ideas', (req, res) => {
  const { sort } = req.query;
  const orderBy = {
    top:          'votes DESC, i.created_at DESC',
    newest:       'i.created_at DESC',
    oldest:       'i.created_at ASC',
    most_zapped:  'i.total_sats_received DESC, i.created_at DESC',
    biggest_team: 'team_size DESC, i.created_at DESC',
  }[sort] || 'votes DESC, i.created_at DESC';
  const rows = db.prepare(`
    SELECT i.*,
      u.name as author_name, u.username as author_username, u.avatar as author_avatar,
      COALESCE(v.vote_count, 0) as votes,
      COALESCE(t.team_size, 0) as team_size
    FROM ideas i
    LEFT JOIN users u ON i.user_id = u.id
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'idea' GROUP BY target_id) v ON i.id = v.target_id
    LEFT JOIN (SELECT idea_id, COUNT(*) as team_size FROM idea_members GROUP BY idea_id) t ON i.id = t.idea_id
    ORDER BY ${orderBy}
  `).all();
  const visibleRows = filterPublicIdeas(rows);
  // Attach first 2 member names per idea
  for (const row of visibleRows) {
    const names = db.prepare(
      `SELECT u.name FROM idea_members im JOIN users u ON im.user_id = u.id WHERE im.idea_id = ? ORDER BY im.created_at ASC LIMIT 2`
    ).all(row.id);
    row.member_names = names.map(n => n.name).join(', ') || null;
  }
  res.json(visibleRows);
});

// POST /api/ideas — create idea
app.post('/api/ideas', requireAuth, (req, res) => {
  const { title, description, looking_for } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  if (isPlaceholderIdea({ title, description })) return res.status(400).json({ error: 'Idea looks like placeholder content' });
  const id = crypto.randomUUID();
  const slug = uniqueSlug('ideas', toSlug(title.trim()));
  const lookingFor = Array.isArray(looking_for) ? looking_for.join(',') : (looking_for || null);
  db.prepare('INSERT INTO ideas (id, title, description, user_id, slug, total_sats_received, looking_for) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
    id, title.trim(), description || null, req.user?.id || null, slug, lookingFor
  );
  if (req.user?.id) cachedBadgeCheck(req.user.id);
  res.json({ id, slug });
});

// GET /api/ideas/:id — idea detail with votes, zaps, team
app.get('/api/ideas/:id', (req, res) => {
  const row = db.prepare(`
    SELECT i.*,
      u.name as author_name, u.username as author_username, u.avatar as author_avatar,
      COALESCE(v.vote_count, 0) as votes,
      COALESCE(z.zap_total, 0) as zap_total,
      COALESCE(t.team_size, 0) as team_size
    FROM ideas i
    LEFT JOIN users u ON i.user_id = u.id
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'idea' GROUP BY target_id) v ON i.id = v.target_id
    LEFT JOIN (SELECT target_id, COALESCE(SUM(amount_sats), 0) as zap_total FROM zaps WHERE target_type = 'idea' AND status = 'confirmed' GROUP BY target_id) z ON i.id = z.target_id
    LEFT JOIN (SELECT idea_id, COUNT(*) as team_size FROM idea_members GROUP BY idea_id) t ON i.id = t.idea_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row || isPlaceholderIdea(row)) return res.status(404).json({ error: 'Not found' });
  // Track views
  const today = new Date().toISOString().slice(0, 10);
  if (row.views_date === today) {
    db.prepare('UPDATE ideas SET views_today = views_today + 1 WHERE id = ?').run(req.params.id);
    row.views_today = (row.views_today || 0) + 1;
  } else {
    db.prepare('UPDATE ideas SET views_today = 1, views_date = ? WHERE id = ?').run(today, req.params.id);
    row.views_today = 1;
    row.views_date = today;
  }
  const members = db.prepare(`
    SELECT im.id, im.user_id, im.created_at, u.name, u.username, u.avatar
    FROM idea_members im
    LEFT JOIN users u ON im.user_id = u.id
    WHERE im.idea_id = ?
    ORDER BY im.created_at ASC
  `).all(req.params.id);
  res.json({ ...row, members });
});

// PUT /api/ideas/:id — edit idea (author or admin)
app.put('/api/ideas/:id', requireAuth, (req, res) => {
  const idea = stmts.getIdeaById.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  if (idea.user_id && req.user?.id !== idea.user_id && !req.user?.is_admin) {
    return res.status(403).json({ error: 'Not your idea' });
  }
  const { title, description, looking_for } = req.body;
  if (title !== undefined && (!title || !title.trim())) return res.status(400).json({ error: 'title required' });
  const newTitle = title !== undefined ? title.trim() : idea.title;
  const newDesc = description !== undefined ? (description || null) : idea.description;
  if (isPlaceholderIdea({ title: newTitle, description: newDesc })) return res.status(400).json({ error: 'Idea looks like placeholder content' });
  const newLooking = looking_for !== undefined ? (Array.isArray(looking_for) ? looking_for.join(',') : (looking_for || null)) : idea.looking_for;
  const newSlug = title !== undefined ? uniqueSlug('ideas', toSlug(newTitle)) : idea.slug;
  db.prepare('UPDATE ideas SET title = ?, description = ?, looking_for = ?, slug = ? WHERE id = ?').run(
    newTitle, newDesc, newLooking, newSlug, req.params.id
  );
  res.json({ ok: true, slug: newSlug });
});

// DELETE /api/ideas/:id — delete idea (author or admin)
app.delete('/api/ideas/:id', requireAuth, (req, res) => {
  const idea = stmts.getIdeaById.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  if (idea.user_id && req.user?.id !== idea.user_id && !req.user?.is_admin) {
    return res.status(403).json({ error: 'Not your idea' });
  }
  db.prepare('DELETE FROM idea_members WHERE idea_id = ?').run(req.params.id);
  stmts.deleteVotes.run('idea', req.params.id);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/ideas/:id/zap — generate invoice to zap this idea
app.post('/api/ideas/:id/zap', requireAuth, async (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum' });
  // Idea zaps pool for the team, not forwarded to author
  const recipientAddress = null;
  const recipient = 'Idea Pool';
  try {
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const lnbitsInv = await lnbitsCreateInvoice(amount_sats, `Zap: ${idea.title}`, webhookUrl);
    const zapId = crypto.randomUUID();
    const zapNote = (req.body.note || '').trim() || null;
    db.prepare(`INSERT INTO zaps (id, target_type, target_id, user_id, user_name, amount_sats, payment_request, payment_hash, verify_url, status, recipient_address, note)
      VALUES (?, 'idea', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?)`).run(
      zapId, idea.id, req.user.id, req.user.name || req.user.email, amount_sats, lnbitsInv.payment_request, lnbitsInv.payment_hash, recipientAddress, zapNote
    );
    const qrData = 'lightning:' + lnbitsInv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({ zap_id: zapId, payment_request: lnbitsInv.payment_request, qr_data_url, recipient });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/ideas/:id/zaps — confirmed zaps for this idea
app.get('/api/ideas/:id/zaps', (req, res) => {
  const zaps = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, note, created_at FROM zaps WHERE target_type = 'idea' AND target_id = ? AND status = 'confirmed' ORDER BY created_at DESC LIMIT 20`
  ).all(req.params.id);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE target_type = 'idea' AND target_id = ? AND status = 'confirmed'`
  ).get(req.params.id);
  res.json({ zaps, total_sats: row?.total || 0 });
});

// POST /api/ideas/:id/join — join the idea team
app.post('/api/ideas/:id/join', requireAuth, (req, res) => {
  const idea = stmts.getIdeaById.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  const existing = db.prepare('SELECT id FROM idea_members WHERE idea_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Already a member' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO idea_members (id, idea_id, user_id) VALUES (?, ?, ?)').run(id, req.params.id, req.user.id);
  // Notify idea author
  if (idea.user_id) notify(idea.user_id, 'team_join', req.user.id, req.user.name || 'Someone', 'idea', req.params.id, idea.title);
  res.json({ ok: true });
});

// POST /api/ideas/:id/leave — leave the idea team
app.post('/api/ideas/:id/leave', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM idea_members WHERE idea_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Not a member' });
  res.json({ ok: true });
});

// GET /api/ideas/:id/comments
app.get('/api/ideas/:id/comments', (req, res) => {
  const voterId = req.user?.id || (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const rows = db.prepare(`
    SELECT c.*, COALESCE(v.vote_count, 0) as votes,
      CASE WHEN uv.voter_ip IS NOT NULL THEN 1 ELSE 0 END as voted
    FROM comments c
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'comment' GROUP BY target_id) v ON c.id = v.target_id
    LEFT JOIN votes uv ON uv.target_type = 'comment' AND uv.target_id = c.id AND uv.voter_ip = ?
    WHERE c.deck_id = ?
    ORDER BY c.created_at ASC
  `).all(voterId, req.params.id);
  res.json(filterPublicComments(rows));
});

// POST /api/ideas/:id/comments
app.post('/api/ideas/:id/comments', requireAuth, (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  if (hasBlockedCommentContent(content)) return res.status(400).json({ error: 'Comment violates content rules' });
  if (parent_id) {
    const parent = db.prepare('SELECT id, deck_id, parent_id FROM comments WHERE id = ?').get(parent_id);
    if (!parent || parent.deck_id !== req.params.id) return res.status(400).json({ error: 'Invalid parent comment' });
  }
  const id = crypto.randomUUID();
  const authorName = req.user?.name || 'Anonymous';
  db.prepare('INSERT INTO comments (id, deck_id, user_id, author_name, content, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, req.user?.id || null, authorName, content.trim(), parent_id || null
  );
  const _idea = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(req.params.id);
  if (parent_id) {
    const rootId = db.prepare('SELECT COALESCE(parent_id, id) as root FROM comments WHERE id = ?').get(parent_id)?.root || parent_id;
    if (_idea?.user_id) notify(_idea.user_id, 'reply', req.user.id, authorName, 'idea', req.params.id, _idea.title);
    const threadUsers = db.prepare('SELECT DISTINCT user_id FROM comments WHERE (id = ? OR parent_id = ?) AND user_id IS NOT NULL AND user_id != ?').all(rootId, rootId, req.user.id);
    for (const u of threadUsers) {
      if (u.user_id !== _idea?.user_id) notify(u.user_id, 'reply', req.user.id, authorName, 'idea', req.params.id, _idea?.title);
    }
  } else {
    if (_idea?.user_id) notify(_idea.user_id, 'comment', req.user.id, authorName, 'idea', req.params.id, _idea.title);
  }
  res.json({ id });
});

// POST /api/ideas/:id/convert — convert idea to project
app.post('/api/ideas/:id/convert', requireAuth, (req, res) => {
  const idea = stmts.getIdeaById.get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  if (idea.user_id && req.user?.id !== idea.user_id && !req.user?.is_admin) {
    return res.status(403).json({ error: 'Only the idea author or admin can convert' });
  }
  if (idea.converted_to_project_id) return res.status(409).json({ error: 'Already converted' });

  const projectName = (req.body.name || idea.title || '').trim();
  if (!projectName) return res.status(400).json({ error: 'Project name required' });

  const projectId = crypto.randomUUID();
  const builderName = req.user?.name || 'Anonymous';
  const slug = uniqueSlug('projects', toSlug(projectName));

  db.prepare(`INSERT INTO projects (id, name, builder, description, status, user_id, slug, total_sats_received, source_idea_id)
    VALUES (?, ?, ?, ?, 'building', ?, ?, ?, ?)`).run(
    projectId, projectName, builderName, idea.description || '', req.user.id, slug, idea.total_sats_received || 0, idea.id
  );

  // Update idea with link to project
  db.prepare('UPDATE ideas SET converted_to_project_id = ? WHERE id = ?').run(projectId, idea.id);

  // Copy team members as bounty_participants (closest existing pattern)
  const members = db.prepare('SELECT user_id FROM idea_members WHERE idea_id = ?').all(idea.id);
  for (const m of members) {
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(m.user_id);
    db.prepare('INSERT INTO bounty_participants (id, bounty_id, user_id, user_name) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), projectId, m.user_id, user?.name || 'Anonymous'
    );
  }

  res.json({ project_id: projectId, project_slug: slug });
});

// ─── Project Deck Versions API ────────────────────────────────────────────────

// GET /api/projects/:id/decks — list all deck versions with deck metadata
app.get('/api/projects/:id/decks', (req, res) => {
  const rows = db.prepare(`
    SELECT pd.id, pd.project_id, pd.deck_id, pd.version, pd.label, pd.is_current, pd.created_at,
           d.title, d.thumbnail, d.entry_point
    FROM project_decks pd
    JOIN decks d ON pd.deck_id = d.id
    WHERE pd.project_id = ?
    ORDER BY pd.version ASC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/projects/:id/decks — link an existing deck as a new version
app.post('/api/projects/:id/decks', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { deck_id, label } = req.body;
  if (!deck_id) return res.status(400).json({ error: 'deck_id required' });
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(deck_id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  const lastVersion = db.prepare('SELECT MAX(version) as v FROM project_decks WHERE project_id = ?').get(req.params.id);
  const version = (lastVersion?.v || 0) + 1;
  const resolvedLabel = label || `v${version}`;

  db.prepare('UPDATE project_decks SET is_current = 0 WHERE project_id = ?').run(req.params.id);

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO project_decks (id, project_id, deck_id, version, label, is_current) VALUES (?, ?, ?, ?, ?, 1)')
    .run(id, req.params.id, deck_id, version, resolvedLabel);

  // Mark deck hidden so it won't appear in gallery
  db.prepare('UPDATE decks SET hidden = 1 WHERE id = ?').run(deck_id);

  res.json({ id, version, label: resolvedLabel });
});

// POST /api/projects/:id/decks/upload — upload a new deck directly as a project version
app.post('/api/projects/:id/decks/upload', requireAuth, upload.single('file'), async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Not found' });
  }
  if (!canManageProject(project, req.user)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { label } = req.body;
  const lastVersion = db.prepare('SELECT MAX(version) as v FROM project_decks WHERE project_id = ?').get(req.params.id);
  const version = (lastVersion?.v || 0) + 1;
  const resolvedLabel = label || `v${version}`;

  const deckId = crypto.randomUUID();
  const deckDir = path.join(UPLOADS_DIR, deckId);
  fs.mkdirSync(deckDir, { recursive: true });

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let entryPoint = 'index.html';

    if (ext === '.zip') {
      await fs.createReadStream(req.file.path)
        .pipe(unzipper.Extract({ path: deckDir }))
        .promise();
      fs.copyFileSync(req.file.path, path.join(deckDir, '_original.zip'));
      entryPoint = detectEntryPoint(deckDir) || 'index.html';
    } else {
      fs.copyFileSync(req.file.path, path.join(deckDir, 'index.html'));
    }
    fs.unlinkSync(req.file.path);

    const deckTitle = `${project.name} — ${resolvedLabel}`;
    db.prepare(`INSERT INTO decks (id, title, author, filename, entry_point, uploaded_by, hidden)
      VALUES (?, ?, ?, ?, ?, ?, 1)`).run(
      deckId, deckTitle, project.builder || 'Anonymous',
      req.file.originalname, entryPoint, req.user?.id
    );

    // Set all previous versions as not current, then insert new one
    db.prepare('UPDATE project_decks SET is_current = 0 WHERE project_id = ?').run(req.params.id);

    const versionId = crypto.randomUUID();
    db.prepare('INSERT INTO project_decks (id, project_id, deck_id, version, label, is_current) VALUES (?, ?, ?, ?, ?, 1)')
      .run(versionId, req.params.id, deckId, version, resolvedLabel);

    generateThumbnail(deckId, entryPoint).catch(err => {
      console.warn(`[thumb] ${deckId}: ${err.message}`);
    });

    res.json({ deck_id: deckId, version, label: resolvedLabel });
  } catch (err) {
    console.error('Project deck upload error:', err);
    fs.rmSync(deckDir, { recursive: true, force: true });
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// DELETE /api/projects/:id/decks/:version_id — remove a version
app.delete('/api/projects/:id/decks/:version_id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const entry = db.prepare('SELECT * FROM project_decks WHERE id = ? AND project_id = ?')
    .get(req.params.version_id, req.params.id);
  if (!entry) return res.status(404).json({ error: 'Version not found' });

  const total = db.prepare('SELECT COUNT(*) as c FROM project_decks WHERE project_id = ?').get(req.params.id).c;
  if (total <= 1) return res.status(400).json({ error: 'Cannot delete the only version' });

  db.prepare('DELETE FROM project_decks WHERE id = ?').run(req.params.version_id);

  // If deleted version was current, promote the most recent remaining one
  if (entry.is_current) {
    const prev = db.prepare('SELECT * FROM project_decks WHERE project_id = ? ORDER BY version DESC LIMIT 1')
      .get(req.params.id);
    if (prev) db.prepare('UPDATE project_decks SET is_current = 1 WHERE id = ?').run(prev.id);
  }

  res.json({ ok: true });
});

// PATCH /api/projects/:id/decks/:version_id/set-current — set a version as current
app.patch('/api/projects/:id/decks/:version_id/set-current', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const entry = db.prepare('SELECT * FROM project_decks WHERE id = ? AND project_id = ?')
    .get(req.params.version_id, req.params.id);
  if (!entry) return res.status(404).json({ error: 'Version not found' });

  db.prepare('UPDATE project_decks SET is_current = 0 WHERE project_id = ?').run(req.params.id);
  db.prepare('UPDATE project_decks SET is_current = 1 WHERE id = ?').run(req.params.version_id);

  res.json({ ok: true });
});

// ─── User Profile API ─────────────────────────────────────────────────────────

app.get('/api/leaderboard', (req, res) => {
  const sort = req.query.sort || 'earners';
  const requestedOffset = Number.parseInt(req.query.offset, 10);
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  let rows;
  if (sort === 'zappers') {
    rows = db.prepare(`
      SELECT u.id as user_id, u.name, u.avatar, u.badges,
        COALESCE(SUM(CASE WHEN b.paid_out = 1 THEN b.sats_amount ELSE 0 END), 0) as bounty_sats,
        COUNT(CASE WHEN b.paid_out = 1 THEN 1 END) as bounties_won,
        COALESCE(u.total_sats_received, 0) as zaps_received,
        (SELECT COALESCE(SUM(z.amount_sats),0) FROM zaps z WHERE z.user_id=u.id AND z.status='confirmed') +
        (SELECT COALESCE(SUM(bp.amount_sats),0) FROM bounty_payments bp WHERE bp.user_id=u.id AND bp.payment_type='fund' AND bp.status='confirmed') as sort_val
      FROM users u LEFT JOIN bounties b ON b.winner_id = u.id
      WHERE u.name IS NOT NULL GROUP BY u.id ORDER BY sort_val DESC
    `).all();
  } else if (sort === 'projects') {
    rows = db.prepare(`
      SELECT u.id as user_id, u.name, u.avatar, u.badges,
        COALESCE(SUM(CASE WHEN b.paid_out = 1 THEN b.sats_amount ELSE 0 END), 0) as bounty_sats,
        COUNT(CASE WHEN b.paid_out = 1 THEN 1 END) as bounties_won,
        COALESCE(u.total_sats_received, 0) as zaps_received,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) as sort_val
      FROM users u LEFT JOIN bounties b ON b.winner_id = u.id
      WHERE u.name IS NOT NULL GROUP BY u.id ORDER BY sort_val DESC
    `).all();
  } else if (sort === 'active') {
    rows = db.prepare(`
      SELECT u.id as user_id, u.name, u.avatar, u.badges,
        COALESCE(SUM(CASE WHEN b.paid_out = 1 THEN b.sats_amount ELSE 0 END), 0) as bounty_sats,
        COUNT(CASE WHEN b.paid_out = 1 THEN 1 END) as bounties_won,
        COALESCE(u.total_sats_received, 0) as zaps_received,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) +
        (SELECT COUNT(*) FROM bounty_participants bp2 WHERE bp2.user_id=u.id) +
        (SELECT COUNT(*) FROM zaps z WHERE z.user_id=u.id AND z.status='confirmed') +
        (SELECT COUNT(*) FROM bounty_payments bpay WHERE bpay.user_id=u.id AND bpay.status='confirmed') as sort_val
      FROM users u LEFT JOIN bounties b ON b.winner_id = u.id
      WHERE u.name IS NOT NULL GROUP BY u.id ORDER BY sort_val DESC
    `).all();
  } else {
    rows = db.prepare(`
      SELECT u.id as user_id, u.name, u.avatar, u.badges,
        COALESCE(SUM(CASE WHEN b.paid_out = 1 THEN b.sats_amount ELSE 0 END), 0) as bounty_sats,
        COUNT(CASE WHEN b.paid_out = 1 THEN 1 END) as bounties_won,
        COALESCE(u.total_sats_received, 0) as zaps_received,
        (COALESCE(SUM(CASE WHEN b.paid_out = 1 THEN b.sats_amount ELSE 0 END), 0) + COALESCE(u.total_sats_received, 0)) as sort_val
      FROM users u LEFT JOIN bounties b ON b.winner_id = u.id
      WHERE u.name IS NOT NULL GROUP BY u.id ORDER BY sort_val DESC, bounties_won DESC
    `).all();
  }

  const leaderboard = filterPublicLeaderboardRows(rows)
    .map((u, i) => {
      const projects_count = db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id = ?').get(u.user_id)?.c || 0;
      const zaps_sent = db.prepare('SELECT COALESCE(SUM(amount_sats),0) as s FROM zaps WHERE user_id = ? AND status = ?').get(u.user_id, 'confirmed')?.s || 0;
      let badges = [];
      try { badges = JSON.parse(u.badges || '[]'); } catch {}
      const total_sats = Number(u.bounty_sats) + Number(u.zaps_received);
      return {
        rank: i + 1,
        user_id: u.user_id,
        name: u.name,
        avatar: u.avatar,
        total_sats,
        bounty_sats: Number(u.bounty_sats),
        zaps_received: Number(u.zaps_received),
        zaps_sent,
        bounties_won: Number(u.bounties_won || 0),
        projects_count,
        badges,
        sort_val: Number(u.sort_val || 0),
      };
    });

  const total = leaderboard.length;
  const results = leaderboard.slice(offset, offset + limit);
  const meRank = req.user ? leaderboard.find(entry => entry.user_id === req.user.id) || null : null;
  const totalSatsDistributed = leaderboard.reduce((sum, entry) => sum + Number(entry.total_sats || 0), 0);

  res.json({
    results,
    total,
    offset,
    limit,
    has_more: offset + results.length < total,
    my_rank: meRank ? {
      rank: meRank.rank,
      user_id: meRank.user_id,
      name: meRank.name,
      total_sats: meRank.total_sats,
      sort_val: meRank.sort_val,
    } : null,
    total_sats_distributed: totalSatsDistributed,
  });
});

app.get('/api/users/:id', (req, res) => {
  cachedBadgeCheck(req.params.id);
  const user = db.prepare('SELECT id, name, email, avatar, is_admin, created_at, lightning_address, badges, bio, website_url, github_url, banner_preset FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const deckCount = db.prepare('SELECT COUNT(*) as c FROM decks WHERE uploaded_by = ?').get(req.params.id).c;
  const projectCount = db.prepare("SELECT COUNT(*) as c FROM projects WHERE user_id = ? OR builder = ?").get(req.params.id, user.name).c;
  const bountySats = db.prepare("SELECT COALESCE(SUM(sats_amount), 0) as s FROM bounties WHERE winner_id = ? AND paid_out = 1").get(req.params.id)?.s || 0;
  const bountiesWon = db.prepare("SELECT COUNT(*) as c FROM bounties WHERE winner_id = ? AND paid_out = 1").get(req.params.id)?.c || 0;
  const zapsReceived = db.prepare("SELECT COALESCE(total_sats_received, 0) as s FROM users WHERE id = ?").get(req.params.id)?.s || 0;
  const totalSats = Number(bountySats) + Number(zapsReceived);
  const zapsSent = db.prepare("SELECT COALESCE(SUM(amount_sats), 0) as s FROM zaps WHERE user_id = ? AND status = 'confirmed'").get(req.params.id)?.s || 0;
  const bountyFunded = db.prepare("SELECT COALESCE(SUM(amount_sats), 0) as s FROM bounty_payments WHERE user_id = ? AND payment_type = 'fund' AND status = 'confirmed'").get(req.params.id)?.s || 0;
  const totalZapsSent = Number(zapsSent) + Number(bountyFunded);
  const upcomingPresenter = getUpcomingPresenterState(req.params.id);
  let badges = [];
  try { badges = JSON.parse(user.badges || '[]'); } catch {}
  res.json({ ...user, badges, upcoming_presenter: upcomingPresenter, deck_count: deckCount, project_count: projectCount, total_sats_earned: totalSats, bounty_sats: Number(bountySats), zaps_received: Number(zapsReceived), bounties_won: bountiesWon, total_zaps_sent: totalZapsSent });
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

app.get('/api/users/:id/bounties', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, bp.created_at as joined_at
    FROM bounty_participants bp
    JOIN bounties b ON bp.bounty_id = b.id
    WHERE bp.user_id = ?
    ORDER BY bp.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

app.get('/api/users/:id/activity', (req, res) => {
  const userId = req.params.id;
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!user) return res.json([]);

  const items = [];

  const wonBounties = db.prepare(`
    SELECT id, title, sats_amount, created_at FROM bounties
    WHERE winner_id = ? AND paid_out = 1 ORDER BY created_at DESC LIMIT 10
  `).all(userId);
  for (const b of wonBounties) {
    items.push({ type: 'bounty_won', text: `Won ${b.sats_amount.toLocaleString()} sats on "${b.title}"`, created_at: b.created_at, ref_id: b.id });
  }

  const projects = db.prepare(`
    SELECT id, name, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(userId);
  for (const p of projects) {
    items.push({ type: 'project', text: `Submitted "${p.name}"`, created_at: p.created_at, ref_id: p.id });
  }

  const joined = db.prepare(`
    SELECT bp.created_at, b.id as bounty_id, b.title
    FROM bounty_participants bp JOIN bounties b ON bp.bounty_id = b.id
    WHERE bp.user_id = ? ORDER BY bp.created_at DESC LIMIT 10
  `).all(userId);
  for (const j of joined) {
    items.push({ type: 'bounty_joined', text: `Joined "${j.title}"`, created_at: j.created_at, ref_id: j.bounty_id });
  }

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(items.slice(0, 20));
});

// ─── Activity Chart API ───────────────────────────────────────────────────────

app.get('/api/users/:id/activity-chart', (req, res) => {
  const userId = req.params.id;
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  if (!user) return res.json({ days: [] });

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  const rows = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as cnt FROM (
      SELECT created_at FROM bounty_participants WHERE user_id = ?1
      UNION ALL
      SELECT created_at FROM projects WHERE user_id = ?1
      UNION ALL
      SELECT created_at FROM bounties WHERE winner_id = ?1 AND paid_out = 1
      UNION ALL
      SELECT created_at FROM decks WHERE uploaded_by = ?1
      UNION ALL
      SELECT created_at FROM votes WHERE voter_ip = ?1
      UNION ALL
      SELECT created_at FROM comments WHERE user_id = ?1
    )
    WHERE DATE(created_at) >= ?2 AND DATE(created_at) <= ?3
    GROUP BY day
  `).all(userId, startStr, endStr);

  const countMap = {};
  for (const r of rows) countMap[r.day] = r.cnt;

  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({ date: dateStr, count: countMap[dateStr] || 0 });
  }

  res.json({ days });
});

// ─── Unified Vote API ─────────────────────────────────────────────────────────

function isContentVoteType(type) {
  return ['deck', 'project'].includes(type);
}

function isEventSessionVoteType(type) {
  return type === 'speaker';
}

function isSupportedVoteType(type) {
  return isContentVoteType(type) || isEventSessionVoteType(type) || ['comment', 'idea'].includes(type);
}

function getVoteActorId(req) {
  return req.user ? req.user.id : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
}

function getVoteState(type, id, voter) {
  return {
    votes: stmts.getVoteCount.get(type, id).c,
    voted: !!stmts.hasVoted.get(type, id, voter),
  };
}

function getVoteStateMap(type, ids, voter) {
  const result = {};
  for (const id of ids) result[id] = getVoteState(type, id, voter);
  return result;
}

function assertEventSessionVoteAllowed(type, id) {
  if (!isEventSessionVoteType(type)) return;
  const speakerVotingState = db.prepare(`
    SELECT ls.voting_open, ls.is_active, ls.current_speaker_id, ls.status, COALESCE(s.status, 'scheduled') AS speaker_status
    FROM speakers s
    LEFT JOIN live_sessions ls ON ls.event_id = s.event_id
    WHERE s.id = ?
  `).get(id);
  if (speakerVotingState?.is_active) {
    const finalVotingSession = speakerVotingState.status === 'voting' && !speakerVotingState.current_speaker_id;
    const finalVotingOpen = Number(speakerVotingState.voting_open || 0)
      && finalVotingSession
      && speakerVotingState.speaker_status !== 'skipped';
    if (!finalVotingOpen) throw new Error('Voting is closed for this speaker right now');
  }
}

function notifyVoteTarget(type, id, req) {
  const actorName = req.user.name || req.user.email || 'Someone';
  if (type === 'deck') {
    const _d = stmts.getById.get(id);
    if (_d?.uploaded_by) notify(_d.uploaded_by, 'vote', req.user.id, actorName, 'deck', id, _d.title);
  } else if (type === 'project') {
    const _p = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(id);
    if (_p?.user_id) notify(_p.user_id, 'vote', req.user.id, actorName, 'project', id, _p.name);
  } else if (type === 'comment') {
    const _c = db.prepare('SELECT user_id, content FROM comments WHERE id = ?').get(id);
    if (_c?.user_id) notify(_c.user_id, 'vote', req.user.id, actorName, 'comment', id, (_c.content || '').substring(0, 50));
  } else if (type === 'idea') {
    const _i = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(id);
    if (_i?.user_id) notify(_i.user_id, 'vote', req.user.id, actorName, 'idea', id, _i.title);
  }
}

function handleVoteSideEffects(type, id, wasExisting) {
  if (type === 'project' && !wasExisting) {
    const proj = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(id);
    if (proj?.user_id) cachedBadgeCheck(proj.user_id);
  }
  if (type === 'idea' && !wasExisting) {
    const idea = db.prepare('SELECT user_id FROM ideas WHERE id = ?').get(id);
    if (idea?.user_id) cachedBadgeCheck(idea.user_id);
  }
}
function toggleContentVote(type, id, voter, req) {
  const existing = stmts.hasVoted.get(type, id, voter);
  if (existing) {
    return { ...getVoteState(type, id, voter), voted: true };
  }
  stmts.addVote.run(type, id, voter);
  notifyVoteTarget(type, id, req);
  handleVoteSideEffects(type, id, false);
  const nextState = getVoteState(type, id, voter);
  return { ...nextState, voted: true };
}

function toggleEventSessionVote(type, id, voter, req) {
  assertEventSessionVoteAllowed(type, id);
  const existing = stmts.hasVoted.get(type, id, voter);
  if (existing) {
    return { ...getVoteState(type, id, voter), voted: true };
  }
  stmts.addVote.run(type, id, voter);
  notifyVoteTarget(type, id, req);
  const nextState = getVoteState(type, id, voter);
  return { ...nextState, voted: true };
}

app.post('/api/vote', requireAuth, (req, res) => {
  const { type, id } = req.body;
  if (!isSupportedVoteType(type) || !id) {
    return res.status(400).json({ error: 'type (deck|speaker|project|comment|idea) and id required' });
  }
  const voter = getVoteActorId(req);
  try {
    const voteResult = isEventSessionVoteType(type)
      ? toggleEventSessionVote(type, id, voter, req)
      : toggleContentVote(type, id, voter, req);
    res.json(voteResult);
  } catch (error) {
    res.status(409).json({ error: error.message || 'Voting is unavailable right now' });
  }
});

// GET /api/vote/count?type=X&id=Y
app.get('/api/vote/count', (req, res) => {
  const { type, id } = req.query;
  if (!isSupportedVoteType(type) || !id) {
    return res.status(400).json({ error: 'type and id required' });
  }
  const voter = getVoteActorId(req);
  const voteState = getVoteState(type, id, voter);
  res.json(voteState);
});

// GET /api/vote/check?type=X&ids=id1,id2,id3
app.get('/api/vote/check', (req, res) => {
  const { type, ids } = req.query;
  if (!isSupportedVoteType(type) || !ids) {
    return res.status(400).json({ error: 'type and ids required' });
  }
  const voter = getVoteActorId(req);
  const idList = ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
  const result = getVoteStateMap(type, idList, voter);
  res.json(result);
});

// ─── Notifications API ───────────────────────────────────────────────────────

// GET /api/notifications — recent notifications + unread count
app.get('/api/notifications', requireAuth, (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const notifications = stmts.getNotificationsPage.all(req.user.id, limit, offset);
  const unread_count = stmts.getUnreadCount.get(req.user.id).c;
  const total_count = stmts.getNotificationsCount.get(req.user.id).c;
  res.json({ notifications, unread_count, total_count, limit, offset, has_more: offset + notifications.length < total_count });
});

// POST /api/notifications/read — mark one notification as read
app.post('/api/notifications/read', requireAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  stmts.markNotifRead.run(id, req.user.id);
  res.json({ ok: true });
});

// POST /api/notifications/read-all — mark all as read
app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  stmts.markAllNotifsRead.run(req.user.id);
  res.json({ ok: true });
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
    ORDER BY c.created_at ASC
  `).all(req.params.id);
  // Attach per-user voted status
  for (const c of comments) {
    c.voted = !!stmts.hasVoted.get('comment', c.id, voter);
  }
  res.json(comments);
});

// POST /api/decks/:id/comments — add comment (requires auth)
app.post('/api/decks/:id/comments', requireAuth, (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
  const deck = stmts.getById.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (parent_id) {
    const parent = db.prepare('SELECT id, deck_id, parent_id FROM comments WHERE id = ?').get(parent_id);
    if (!parent || parent.deck_id !== req.params.id) return res.status(400).json({ error: 'Invalid parent comment' });
  }
  const id = crypto.randomUUID();
  const authorName = req.user.name || req.user.email || 'Anonymous';
  db.prepare('INSERT INTO comments (id, deck_id, user_id, author_name, content, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.params.id, req.user.id, authorName, content.trim(), parent_id || null
  );
  if (parent_id) {
    // Reply: notify deck owner + thread participants
    const rootId = db.prepare('SELECT COALESCE(parent_id, id) as root FROM comments WHERE id = ?').get(parent_id)?.root || parent_id;
    if (deck.uploaded_by) notify(deck.uploaded_by, 'reply', req.user.id, authorName, 'deck', req.params.id, deck.title);
    const threadUsers = db.prepare('SELECT DISTINCT user_id FROM comments WHERE (id = ? OR parent_id = ?) AND user_id IS NOT NULL AND user_id != ?').all(rootId, rootId, req.user.id);
    for (const u of threadUsers) {
      if (u.user_id !== deck.uploaded_by) notify(u.user_id, 'reply', req.user.id, authorName, 'deck', req.params.id, deck.title);
    }
  } else {
    // Top-level comment: notify deck owner only
    if (deck.uploaded_by) notify(deck.uploaded_by, 'comment', req.user.id, authorName, 'deck', req.params.id, deck.title);
  }
  res.json({ id, author_name: authorName, content: content.trim(), votes: 0, voted: false, created_at: new Date().toISOString(), parent_id: parent_id || null });
});

// GET /api/events/:id/bounties
app.get('/api/events/:id/bounties', (req, res) => {
  const rows = db.prepare("SELECT * FROM bounties WHERE event_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json(rows);
});

// ─── Live Presenter Mode API ──────────────────────────────────────────────────

function getOrderedEventSpeakers(eventId) {
  return db.prepare(`
    SELECT s.*, COALESCE(v.vote_count, 0) as votes,
      COALESCE(z.total_sats, 0) as zap_total,
      d.entry_point, d.id as deck_id_real
    FROM speakers s
    LEFT JOIN (SELECT target_id, COUNT(*) as vote_count FROM votes WHERE target_type = 'speaker' GROUP BY target_id) v ON s.id = v.target_id
    LEFT JOIN (
      SELECT target_id, SUM(amount_sats) as total_sats
      FROM zaps
      WHERE target_type = 'speaker' AND status = 'confirmed'
      GROUP BY target_id
    ) z ON s.id = z.target_id
    LEFT JOIN decks d ON s.deck_id = d.id
    WHERE s.event_id = ?
    ORDER BY COALESCE(s.queue_position, 2147483647) ASC, s.created_at ASC
  `).all(eventId).map((speaker) => ({
    ...speaker,
    status: speaker.status || 'scheduled',
  }));
}

function getNextQueueSpeaker(eventId, currentSpeakerId = null) {
  const speakers = getOrderedEventSpeakers(eventId);
  const currentIndex = currentSpeakerId ? speakers.findIndex((speaker) => speaker.id === currentSpeakerId) : -1;
  const afterCurrent = currentIndex >= 0 ? speakers.slice(currentIndex + 1) : speakers;
  const fallback = currentIndex >= 0 ? speakers.slice(0, currentIndex) : [];
  const candidates = [...afterCurrent, ...fallback];
  return candidates.find((speaker) => !['presented', 'skipped', 'winner', 'live'].includes(speaker.status)) || null;
}

function getRecommendedWinner(eventId, providedSpeakers = null) {
  const speakers = providedSpeakers || getOrderedEventSpeakers(eventId);
  return speakers
    .filter((speaker) => speaker.status !== 'skipped')
    .slice()
    .sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)
      || Number(b.zap_total || 0) - Number(a.zap_total || 0)
      || Number(a.queue_position || 2147483647) - Number(b.queue_position || 2147483647)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

function getStoredEventResults(eventId) {
  const row = db.prepare('SELECT * FROM event_results WHERE event_id = ?').get(eventId);
  if (!row) return null;
  let parsed = null;
  if (row.results_json) {
    try {
      parsed = JSON.parse(row.results_json);
    } catch {
      parsed = null;
    }
  }
  return {
    ...row,
    results: parsed,
  };
}

function buildEventResultsRecord(eventId) {
  const event = db.prepare('SELECT id, name, description, event_type as type, date, time, location, virtual_link FROM events WHERE id = ?').get(eventId);
  if (!event) return null;

  const session = db.prepare(`
    SELECT *,
      COALESCE(status, CASE WHEN COALESCE(is_active, 0) = 1 THEN 'live' ELSE 'idle' END) as normalized_status,
      COALESCE(voting_open, 0) as normalized_voting_open,
      COALESCE(payout_status, 'pending') as normalized_payout_status,
      COALESCE(current_duration_minutes, 10) as normalized_current_duration_minutes,
      COALESCE(meet_url, ?) as normalized_meet_url
    FROM live_sessions
    WHERE event_id = ?
  `).get(event.virtual_link || null, eventId);
  const speakers = getOrderedEventSpeakers(eventId);
  if (!speakers.length) return null;

  const rankings = speakers
    .slice()
    .sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0)
      || Number(b.zap_total || 0) - Number(a.zap_total || 0)
      || Number(a.queue_position || 2147483647) - Number(b.queue_position || 2147483647)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map((speaker, index) => ({
      rank: index + 1,
      id: speaker.id,
      name: speaker.name,
      user_id: speaker.user_id || null,
      project_title: speaker.project_title || speaker.project || 'Untitled',
      description: speaker.description || null,
      status: speaker.status || 'scheduled',
      duration: speaker.duration || null,
      votes: Number(speaker.votes || 0),
      zap_total: Number(speaker.zap_total || 0),
      deck_id: speaker.deck_id || speaker.deck_id_real || null,
      github_url: speaker.github_url || null,
      demo_url: speaker.demo_url || null,
      queue_position: Number(speaker.queue_position || 0) || null,
      presented_at: speaker.presented_at || null,
      skipped_at: speaker.skipped_at || null,
    }));

  const winner = rankings.find((speaker) => speaker.id === session?.winner_speaker_id)
    || rankings.find((speaker) => speaker.status === 'winner')
    || (['winner_pending', 'completed'].includes(session?.normalized_status) ? getRecommendedWinner(eventId, speakers) : null);

  const recentSupport = db.prepare(`
    SELECT z.id, z.target_id, z.user_name, z.amount_sats, z.created_at, z.confirmed_at, s.name as speaker_name, s.project_title
    FROM zaps z
    JOIN speakers s ON s.id = z.target_id
    WHERE z.target_type = 'speaker' AND z.status = 'confirmed' AND s.event_id = ?
    ORDER BY z.confirmed_at DESC, z.created_at DESC
    LIMIT 6
  `).all(eventId).map((row) => ({
    id: row.id,
    target_id: row.target_id,
    user_name: row.user_name,
    amount_sats: Number(row.amount_sats || 0),
    created_at: row.confirmed_at || row.created_at,
    speaker_name: row.speaker_name,
    project_title: row.project_title,
  }));

  const totalVotes = rankings.reduce((sum, speaker) => sum + Number(speaker.votes || 0), 0);
  const totalZaps = rankings.reduce((sum, speaker) => sum + Number(speaker.zap_total || 0), 0);
  const completedCount = rankings.filter((speaker) => speaker.status === 'presented' || speaker.status === 'winner').length;
  const skippedCount = rankings.filter((speaker) => speaker.status === 'skipped').length;
  const payoutStatus = session?.normalized_payout_status || 'pending';
  const summaryMarkdown = [
    `# ${event.name} results`,
    winner ? `Winner: ${winner.name} — ${winner.project_title}` : 'Winner: pending',
    `Presenters: ${rankings.length}`,
    `Completed presentations: ${completedCount}`,
    `Skipped presenters: ${skippedCount}`,
    `Total votes: ${totalVotes}`,
    `Total zaps: ${totalZaps} sats`,
    `Payout status: ${payoutStatus}`,
    '',
    '## Rankings',
    ...rankings.map((speaker) => `${speaker.rank}. ${speaker.name} — ${speaker.project_title} (${speaker.votes} votes, ${speaker.zap_total} sats)`),
  ].join('\n');

  const winnerPayload = winner ? {
    id: winner.id,
    name: winner.name,
    user_id: winner.user_id || null,
    project_title: winner.project_title || winner.project || 'Untitled',
    votes: Number(winner.votes || 0),
    zap_total: Number(winner.zap_total || 0),
    deck_id: winner.deck_id || winner.deck_id_real || null,
    github_url: winner.github_url || null,
    demo_url: winner.demo_url || null,
  } : null;

  const results = {
    generated_at: new Date().toISOString(),
    event: {
      id: event.id,
      name: event.name,
      description: event.description || null,
      type: event.type,
      date: event.date || null,
      time: event.time || null,
      location: event.location || null,
    },
    session: session ? {
      id: session.id,
      status: session.normalized_status,
      voting_open: Number(session.normalized_voting_open || 0),
      payout_status: payoutStatus,
      winner_confirmed_at: session.winner_confirmed_at || null,
      ended_at: session.ended_at || null,
      meet_url: session.normalized_meet_url || null,
      current_duration_minutes: Number(session.normalized_current_duration_minutes || 10),
    } : null,
    winner: winnerPayload,
    scoreboard: {
      total_votes: totalVotes,
      total_zaps: totalZaps,
      presenter_count: rankings.length,
      completed_count: completedCount,
      skipped_count: skippedCount,
    },
    rankings,
    recent_support: recentSupport,
    summary_markdown: summaryMarkdown,
  };

  const existing = db.prepare('SELECT id FROM event_results WHERE event_id = ?').get(eventId);
  return {
    id: existing?.id || crypto.randomUUID(),
    event_id: eventId,
    winner_speaker_id: winnerPayload?.id || null,
    winner_name: winnerPayload?.name || null,
    winner_project_title: winnerPayload?.project_title || null,
    total_votes: totalVotes,
    total_zaps: totalZaps,
    results_json: JSON.stringify(results),
    summary_markdown: summaryMarkdown,
  };
}

function upsertEventResults(eventId) {
  const record = buildEventResultsRecord(eventId);
  if (!record) return null;
  db.prepare(`
    INSERT INTO event_results (
      id, event_id, winner_speaker_id, winner_name, winner_project_title,
      total_votes, total_zaps, results_json, summary_markdown
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      winner_speaker_id = excluded.winner_speaker_id,
      winner_name = excluded.winner_name,
      winner_project_title = excluded.winner_project_title,
      total_votes = excluded.total_votes,
      total_zaps = excluded.total_zaps,
      results_json = excluded.results_json,
      summary_markdown = excluded.summary_markdown,
      created_at = CURRENT_TIMESTAMP
  `).run(
    record.id,
    record.event_id,
    record.winner_speaker_id,
    record.winner_name,
    record.winner_project_title,
    record.total_votes,
    record.total_zaps,
    record.results_json,
    record.summary_markdown,
  );
  return getStoredEventResults(eventId);
}

function resetSpeakerStatusesForSession(eventId, liveSpeakerId = null) {
  const speakers = getOrderedEventSpeakers(eventId);
  for (const speaker of speakers) {
    if (['presented', 'skipped', 'winner'].includes(speaker.status)) continue;
    const nextStatus = speaker.id === liveSpeakerId ? 'live' : 'scheduled';
    db.prepare('UPDATE speakers SET status = ? WHERE id = ?').run(nextStatus, speaker.id);
  }
}

function getActiveLiveSessionOrNull(eventId) {
  return db.prepare('SELECT * FROM live_sessions WHERE event_id = ? AND is_active = 1').get(eventId) || null;
}

function getLiveSessionPayload(eventId, viewer = null) {
  const event = db.prepare('SELECT id, name, description, event_type as type, virtual_link FROM events WHERE id = ?').get(eventId);
  if (!event) return null;

  const sessionRow = db.prepare(`
    SELECT *,
      COALESCE(mode, 'demo-day-live') as mode,
      COALESCE(status, CASE WHEN COALESCE(is_active, 0) = 1 THEN 'live' ELSE 'idle' END) as normalized_status,
      COALESCE(voting_open, 0) as normalized_voting_open,
      COALESCE(current_duration_minutes, 10) as normalized_current_duration_minutes,
      COALESCE(payout_status, 'pending') as normalized_payout_status,
      COALESCE(meet_url, ?) as normalized_meet_url
    FROM live_sessions
    WHERE event_id = ?
  `).get(event.virtual_link || null, eventId);

  const speakers = getOrderedEventSpeakers(eventId);
  const session = sessionRow ? {
    ...sessionRow,
    mode: sessionRow.mode || 'demo-day-live',
    status: sessionRow.normalized_status,
    voting_open: Number(sessionRow.normalized_voting_open || 0),
    current_duration_minutes: Number(sessionRow.normalized_current_duration_minutes || 10),
    payout_status: sessionRow.normalized_payout_status || 'pending',
    meet_url: sessionRow.normalized_meet_url || null,
  } : null;

  const current = session?.current_speaker_id
    ? speakers.find((speaker) => speaker.id === session.current_speaker_id) || null
    : null;
  const next_speaker = getNextQueueSpeaker(eventId, session?.current_speaker_id || null);

  const nowMs = Date.now();
  let time_remaining_seconds = null;
  let stage_status_label = 'Offline';
  let time_remaining_label = 'Awaiting next presenter';
  if (session?.is_active) {
    if (session?.status === 'voting' && !session?.current_speaker_id) {
      stage_status_label = 'Voting is now open';
      time_remaining_label = 'Cast your votes before winner selection';
    } else if (session?.status === 'presentations_complete') {
      stage_status_label = 'All Presentations Complete';
      time_remaining_label = 'Host can open final voting when ready';
    } else if (session?.status === 'winner_pending') {
      stage_status_label = 'Winner Pending';
      time_remaining_label = 'Winner Pending';
    } else if (!current) {
      stage_status_label = 'Waiting for next presenter';
      time_remaining_label = 'Awaiting next presenter';
    } else if (session?.status === 'voting') {
      stage_status_label = 'Voting Open';
      time_remaining_label = 'Audience voting is live';
    } else {
      stage_status_label = 'Live Now';
      time_remaining_label = 'Awaiting next presenter';
    }
  }
  if (current && session?.current_started_at) {
    const startMs = Date.parse(session.current_started_at + 'Z');
    const durationSeconds = Number(session.current_duration_minutes || 10) * 60;
    if (Number.isFinite(startMs)) {
      const elapsed = Math.floor((nowMs - startMs) / 1000);
      time_remaining_seconds = Math.max(0, durationSeconds - elapsed);
      if (elapsed < 0) {
        time_remaining_label = `Starts in ${Math.abs(elapsed)}s`;
      } else if (time_remaining_seconds > 0) {
        time_remaining_label = `${time_remaining_seconds}s remaining`;
      } else {
        time_remaining_label = 'Time is up';
      }
    }
  }

  const lineup_groups = {
    current: current ? [current] : [],
    upcoming: speakers.filter((speaker) => !['presented', 'skipped', 'winner'].includes(speaker.status) && speaker.id !== current?.id),
    completed: speakers.filter((speaker) => ['presented', 'skipped', 'winner'].includes(speaker.status)),
  };

  const vote_leader = speakers
    .slice()
    .sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0) || Number(b.zap_total || 0) - Number(a.zap_total || 0) || Number(a.queue_position || 2147483647) - Number(b.queue_position || 2147483647))[0] || null;
  const zap_leader = speakers
    .slice()
    .sort((a, b) => Number(b.zap_total || 0) - Number(a.zap_total || 0) || Number(b.votes || 0) - Number(a.votes || 0) || Number(a.queue_position || 2147483647) - Number(b.queue_position || 2147483647))[0] || null;
  const recent_support = db.prepare(`
    SELECT z.id, z.target_id, z.user_name, z.amount_sats, z.created_at, s.name as speaker_name, s.project_title
    FROM zaps z
    JOIN speakers s ON s.id = z.target_id
    WHERE z.target_type = 'speaker' AND z.status = 'confirmed' AND s.event_id = ?
    ORDER BY z.confirmed_at DESC, z.created_at DESC
    LIMIT 4
  `).all(eventId);
  const scoreboard = {
    total_votes: speakers.reduce((sum, speaker) => sum + Number(speaker.votes || 0), 0),
    total_zaps: speakers.reduce((sum, speaker) => sum + Number(speaker.zap_total || 0), 0),
    leader: vote_leader,
    vote_leader,
    zap_leader,
    recent_support,
  };
  const winner_recommendation = getRecommendedWinner(eventId, speakers);
  const winner = session?.winner_speaker_id
    ? speakers.find((speaker) => speaker.id === session.winner_speaker_id) || null
    : null;
  const payout_status_label = {
    pending: 'Payout pending',
    confirmed: 'Payout confirmed',
    sent: 'Payout sent',
  }[session?.payout_status || 'pending'] || 'Payout pending';
  const viewer_role = viewer?.is_admin
    ? 'host'
    : (current?.user_id && viewer?.id && current.user_id === viewer.id ? 'presenter' : 'audience');
  const can_control_slides = !!(current?.user_id && viewer?.id && current.user_id === viewer.id);

  const results = getStoredEventResults(eventId);

  return {
    active: !!session?.is_active,
    event,
    session,
    speaker: current,
    next_speaker,
    speakers,
    lineup_groups,
    scoreboard,
    winner,
    winner_recommendation,
    payout_status_label,
    viewer_role,
    can_control_slides,
    stage_status_label,
    time_remaining_seconds,
    time_remaining_label,
    meet_url: session?.meet_url || event.virtual_link || null,
    results_url: results ? `/event/${eventId}#results` : null,
    results_summary: results ? {
      id: results.id,
      created_at: results.created_at,
      winner_name: results.winner_name,
      winner_project_title: results.winner_project_title,
      total_votes: Number(results.total_votes || 0),
      total_zaps: Number(results.total_zaps || 0),
    } : null,
  };
}

// GET /api/live/:eventId — get current live state (public, no auth for polling)
app.get('/api/live/:eventId', (req, res) => {
  const payload = getLiveSessionPayload(req.params.eventId, req.user || null);
  if (!payload) return res.status(404).json({ error: 'Event not found' });
  if (!payload.active) return res.json({ ...payload, active: false, speaker: null });
  res.json(payload);
});

// POST /api/live/:eventId/start — admin starts live session
app.post('/api/live/:eventId/start', requireAuth, requireAdmin, (req, res) => {
  const event = db.prepare('SELECT id, virtual_link FROM events WHERE id = ?').get(req.params.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const existing = db.prepare('SELECT id FROM live_sessions WHERE event_id = ?').get(req.params.eventId);
  if (existing) {
    db.prepare("UPDATE live_sessions SET is_active = 1, current_speaker_id = NULL, current_started_at = NULL, winner_speaker_id = NULL, winner_confirmed_at = NULL, status = 'live', voting_open = 0, payout_status = 'pending', ended_at = NULL, meet_url = COALESCE(meet_url, ?), updated_at = datetime('now') WHERE event_id = ?").run(event.virtual_link || null, req.params.eventId);
  } else {
    db.prepare("INSERT INTO live_sessions (id, event_id, is_active, mode, status, voting_open, payout_status, meet_url) VALUES (?, ?, 1, 'demo-day-live', 'live', 0, 'pending', ?)").run(crypto.randomUUID(), req.params.eventId, event.virtual_link || null);
  }
  resetSpeakerStatusesForSession(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

// POST /api/live/:eventId/stop — admin ends live session
app.post('/api/live/:eventId/stop', requireAuth, requireAdmin, (req, res) => {
  resetSpeakerStatusesForSession(req.params.eventId);
  db.prepare("UPDATE live_sessions SET is_active = 0, current_speaker_id = NULL, voting_open = 0, status = 'completed', ended_at = datetime('now'), updated_at = datetime('now') WHERE event_id = ?").run(req.params.eventId);
  upsertEventResults(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

// POST /api/live/:eventId/speaker — admin sets current speaker
app.post('/api/live/:eventId/speaker', requireAuth, requireAdmin, (req, res) => {
  const { speaker_id } = req.body;
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (speaker_id) {
    const speaker = db.prepare('SELECT id, status FROM speakers WHERE id = ? AND event_id = ?').get(speaker_id, req.params.eventId);
    if (!speaker) return res.status(404).json({ error: 'Speaker not found in this event' });
    resetSpeakerStatusesForSession(req.params.eventId, speaker_id);
    db.prepare("UPDATE speakers SET status = 'live' WHERE id = ?").run(speaker_id);
  }
  db.prepare("UPDATE live_sessions SET current_speaker_id = ?, current_started_at = datetime('now'), status = 'live', voting_open = 0, updated_at = datetime('now') WHERE event_id = ?").run(speaker_id || null, req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/open-voting', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (activeSession.current_speaker_id || activeSession.status !== 'presentations_complete') {
    return res.status(409).json({ error: 'Final voting can only open after all presentations are complete' });
  }
  db.prepare("UPDATE live_sessions SET voting_open = 1, status = 'voting', updated_at = datetime('now') WHERE event_id = ?").run(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/close-voting', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (!Number(activeSession.voting_open || 0)) return res.status(409).json({ error: 'Final voting is not open' });
  db.prepare("UPDATE live_sessions SET voting_open = 0, status = 'presentations_complete', updated_at = datetime('now') WHERE event_id = ?").run(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/confirm-winner', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (activeSession.current_speaker_id) return res.status(409).json({ error: 'Finish the current presentation before confirming a winner' });
  if (!['voting', 'presentations_complete', 'winner_pending'].includes(activeSession.status)) {
    return res.status(409).json({ error: 'Winner confirmation is only available after presentations finish' });
  }

  const payload = getLiveSessionPayload(req.params.eventId);
  const winnerCandidateId = req.body?.speaker_id || payload?.winner_recommendation?.id;
  if (!winnerCandidateId) return res.status(404).json({ error: 'No eligible winner candidate found' });
  const winnerCandidate = (payload?.speakers || []).find((speaker) => speaker.id === winnerCandidateId && speaker.status !== 'skipped');
  if (!winnerCandidate) return res.status(404).json({ error: 'Winner candidate not found' });

  db.prepare(`
    UPDATE speakers
    SET status = CASE
      WHEN presented_at IS NOT NULL THEN 'presented'
      WHEN skipped_at IS NOT NULL THEN 'skipped'
      ELSE 'scheduled'
    END
    WHERE event_id = ? AND status = 'winner' AND id != ?
  `).run(req.params.eventId, winnerCandidate.id);
  db.prepare("UPDATE speakers SET status = 'winner', presented_at = COALESCE(presented_at, datetime('now')) WHERE id = ?").run(winnerCandidate.id);
  db.prepare("UPDATE live_sessions SET current_speaker_id = NULL, current_started_at = NULL, voting_open = 0, winner_speaker_id = ?, winner_confirmed_at = datetime('now'), payout_status = CASE WHEN payout_status = 'sent' THEN 'sent' ELSE 'pending' END, status = 'winner_pending', updated_at = datetime('now') WHERE event_id = ?")
    .run(winnerCandidate.id, req.params.eventId);

  upsertEventResults(req.params.eventId);
  const nextPayload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload: nextPayload });
});

app.post('/api/live/:eventId/confirm-payout', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (!activeSession.winner_speaker_id) return res.status(409).json({ error: 'Confirm a winner before confirming payout' });
  db.prepare("UPDATE live_sessions SET payout_status = 'confirmed', status = 'winner_pending', updated_at = datetime('now') WHERE event_id = ?").run(req.params.eventId);
  upsertEventResults(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/mark-payout-sent', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (!activeSession.winner_speaker_id) return res.status(409).json({ error: 'Confirm a winner before marking payout sent' });
  db.prepare("UPDATE live_sessions SET payout_status = 'sent', status = 'completed', is_active = 0, ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now') WHERE event_id = ?").run(req.params.eventId);
  upsertEventResults(req.params.eventId);
  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/advance', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  const payload = getLiveSessionPayload(req.params.eventId);
  if (!payload?.session) return res.status(404).json({ error: 'Live session not found' });

  if (payload.session.current_speaker_id) {
    const currentSpeaker = db.prepare('SELECT id, user_id FROM speakers WHERE id = ? AND event_id = ?').get(payload.session.current_speaker_id, req.params.eventId);
    if (currentSpeaker) {
      db.prepare("UPDATE speakers SET presented_at = COALESCE(presented_at, datetime('now')), status = 'presented' WHERE id = ?").run(currentSpeaker.id);
      if (currentSpeaker.user_id) checkAndAwardBadges(currentSpeaker.user_id);
    }
  }

  const nextSpeaker = getNextQueueSpeaker(req.params.eventId, payload.session.current_speaker_id || null);
  resetSpeakerStatusesForSession(req.params.eventId, nextSpeaker?.id || null);
  if (nextSpeaker) {
    db.prepare("UPDATE live_sessions SET current_speaker_id = ?, current_started_at = datetime('now'), voting_open = 0, status = 'live', updated_at = datetime('now') WHERE event_id = ?")
      .run(nextSpeaker.id, req.params.eventId);
  } else {
    db.prepare("UPDATE live_sessions SET current_speaker_id = NULL, current_started_at = NULL, voting_open = 0, status = 'presentations_complete', updated_at = datetime('now') WHERE event_id = ?")
      .run(req.params.eventId);
  }

  const nextPayload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload: nextPayload });
});

app.post('/api/live/:eventId/mark-presented', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  if (!activeSession.current_speaker_id) return res.status(409).json({ error: 'No current speaker to mark presented' });

  const currentSpeaker = db.prepare('SELECT id, user_id FROM speakers WHERE id = ? AND event_id = ?').get(activeSession.current_speaker_id, req.params.eventId);
  if (!currentSpeaker) return res.status(404).json({ error: 'Speaker not found' });

  db.prepare("UPDATE speakers SET presented_at = COALESCE(presented_at, datetime('now')), status = 'presented' WHERE id = ?").run(currentSpeaker.id);
  if (currentSpeaker.user_id) checkAndAwardBadges(currentSpeaker.user_id);
  resetSpeakerStatusesForSession(req.params.eventId);
  const remainingSpeaker = getNextQueueSpeaker(req.params.eventId, currentSpeaker.id);
  const nextStatus = remainingSpeaker ? 'live' : 'presentations_complete';
  db.prepare("UPDATE live_sessions SET current_speaker_id = NULL, current_started_at = NULL, voting_open = 0, status = ?, updated_at = datetime('now') WHERE event_id = ?").run(nextStatus, req.params.eventId);

  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/live/:eventId/unmark-presented', requireAuth, requireAdmin, (req, res) => {
  const activeSession = getActiveLiveSessionOrNull(req.params.eventId);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  const speaker = db.prepare(`
    SELECT * FROM speakers
    WHERE event_id = ? AND presented_at IS NOT NULL
    ORDER BY presented_at DESC, queue_position DESC, created_at DESC
    LIMIT 1
  `).get(req.params.eventId);
  if (!speaker) return res.status(404).json({ error: 'No presented speaker to undo' });

  db.prepare("UPDATE speakers SET presented_at = NULL, status = 'scheduled' WHERE id = ?").run(speaker.id);
  resetSpeakerStatusesForSession(req.params.eventId, speaker.id);
  db.prepare("UPDATE live_sessions SET current_speaker_id = ?, current_started_at = NULL, voting_open = 0, status = 'live', updated_at = datetime('now') WHERE event_id = ?").run(speaker.id, req.params.eventId);

  const payload = getLiveSessionPayload(req.params.eventId);
  res.json({ ok: true, payload });
});

app.post('/api/speakers/:id/skip', requireAuth, requireAdmin, (req, res) => {
  const speaker = db.prepare('SELECT id, event_id FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  const activeSession = getActiveLiveSessionOrNull(speaker.event_id);
  if (!activeSession) return res.status(409).json({ error: 'Live session is not active' });
  db.prepare("UPDATE speakers SET status = 'skipped', skipped_at = COALESCE(skipped_at, datetime('now')) WHERE id = ?").run(req.params.id);
  if (activeSession.current_speaker_id === req.params.id) {
    const remainingSpeaker = getNextQueueSpeaker(speaker.event_id, req.params.id);
    const nextStatus = remainingSpeaker ? 'live' : 'presentations_complete';
    db.prepare("UPDATE live_sessions SET current_speaker_id = NULL, current_started_at = NULL, voting_open = 0, status = ?, updated_at = datetime('now') WHERE event_id = ?").run(nextStatus, speaker.event_id);
  }
  const payload = getLiveSessionPayload(speaker.event_id);
  res.json({ ok: true, payload });
});

app.delete('/api/speakers/:id/skip', requireAuth, requireAdmin, (req, res) => {
  const speaker = db.prepare('SELECT * FROM speakers WHERE id = ?').get(req.params.id);
  if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
  db.prepare("UPDATE speakers SET status = 'scheduled', skipped_at = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
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
<title>Welcome to LunarPad</title>
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
    <div class="logo-mark">🚀 LunarPad</div>
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
    <div class="sub">LunarPad hosts them all — no conversion needed</div>
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
      title: 'Welcome to LunarPad',
      author: 'LunarPad Team',
      description: 'An introduction to LunarPad — the HTML presentation hosting platform. Upload any HTML deck and present it to the world.',
      tags: 'demo,welcome,intro,lunarpad',
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
  // Only seed if no events exist yet (first run)
  const eventCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
  if (eventCount > 0) return;

  console.log('[seed] Inserting platform data...');

  // Events
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), 'LR Hackathon #1',
    'Our first hackathon. Build something with AI in one day. Solo or team. Ship by end of day to qualify.',
    'hackathon', '2026-04-03', '09:00', 'Dubai Office + Remote'
  );
  const eventId = crypto.randomUUID();
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    eventId, 'LR Demo Day #1',
    'Our first community demo day! Show us what you\'ve been building. 5-minute demos, lightning pitches, and good vibes.',
    'demo-day', '2026-04-10', '18:00', 'Virtual — Link TBA'
  );
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), 'LR Demo Day #2',
    'Monthly demo day. Show what you shipped, what you learned, and compete for sats.',
    'demo-day', '2026-05-08', '18:00', 'Virtual — Link TBA'
  );
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), 'LR Demo Day #3',
    'Monthly demo day. Show what you shipped, what you learned, and compete for sats.',
    'demo-day', '2026-06-12', '18:00', 'Virtual — Link TBA'
  );
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), 'LR Demo Day #4',
    'Monthly demo day. Show what you shipped, what you learned, and compete for sats.',
    'demo-day', '2026-07-10', '18:00', 'Virtual — Link TBA'
  );
  db.prepare(`INSERT INTO events (id, name, description, event_type, date, time, location) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), 'Bounty Hunt #1',
    'Our first bounty hunt. Pick a bounty, ship it, earn sats. Solo or team. 48 hours to deliver.',
    'bounty', '2026-04-22', '10:00', 'Async — Work at your own pace'
  );

  // Bounties — the 50k bounty is linked to the demo day event
  const bounties = [
    { title: 'Build a Voting System for Presentations', description: 'Add upvote/downvote capabilities to the LunarPad presentation gallery so the community can surface the best content.', sats_amount: 10000, status: 'completed', tags: 'lunarpad,voting,frontend', event_id: null },
    { title: 'Best Demo at LR Demo Day #1', description: 'Best overall demo at the first LR Demo Day. Judged by audience vote. Ship something real.', sats_amount: 50000, status: 'open', tags: 'lunarpad,platform,fullstack', event_id: eventId },
    { title: 'LNURL-Auth Integration', description: 'Integrate LNURL-Auth so builders can log in with their Lightning wallet — no email, no password, just a QR code scan.', sats_amount: 25000, status: 'open', tags: 'lightning,auth,bitcoin', event_id: null },
    { title: 'Automating the Trading Engine', description: 'Build automation for the banking house trading engine. Connect LPs, implement smart order routing, and enable automated execution across OTC desks. The team that ships a working prototype wins 1 BTC.', sats_amount: 100000000, status: 'open', tags: 'trading,automation,execution,bitcoin', event_id: null },
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
    { name: 'satsdisco', project_title: 'LunarPad', description: 'HTML presentation hosting platform with auto-thumbnails, voting, and a community gallery.', duration: 10, github_url: 'https://github.com/satsdisco/lunarpad', demo_url: 'https://decks.satsdisco.com', deck_id: deckId1 },
    { name: 'noderunner', project_title: 'LNConnect', description: 'A simple dashboard for monitoring your Lightning node channels, capacity, and routing fees in real-time.', duration: 5, github_url: 'https://github.com/noderunner/lnconnect', demo_url: '', deck_id: deckId2 },
  ];
  for (const s of speakers) {
    const nextQueuePosition = (db.prepare('SELECT COALESCE(MAX(queue_position), 0) + 1 as next_pos FROM speakers WHERE event_id = ?').get(eventId)?.next_pos) || 1;
    db.prepare(`INSERT INTO speakers (id, event_id, name, project_title, description, duration, github_url, demo_url, deck_id, queue_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), eventId, s.name, s.project_title, s.description, s.duration, s.github_url || null, s.demo_url || null, s.deck_id || null, nextQueuePosition
    );
  }

  // Projects
  const projects = [
    { name: 'LunarPad', builder: 'satsdisco', description: 'Your stage for HTML presentations. Upload any HTML deck and share it with the world. Built with Express, SQLite, and Puppeteer.', status: 'building', tags: 'web,presentations,hosting,lunarpad', repo_url: 'https://github.com/satsdisco/lunarpad', demo_url: 'https://lunarpad.dev' },
    { name: 'LNConnect', builder: 'noderunner', description: 'Real-time Lightning node monitoring dashboard. Track channels, capacity, routing fees, and peer health from one place.', status: 'building', tags: 'lightning,bitcoin,dashboard,nodes', repo_url: 'https://github.com/noderunner/lnconnect', demo_url: '' },
  ];
  for (const p of projects) {
    db.prepare(`INSERT INTO projects (id, name, builder, description, status, tags, repo_url, demo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), p.name, p.builder, p.description, p.status, p.tags, p.repo_url || null, p.demo_url || null
    );
  }

  backfillEventStartInstants();
  console.log('[seed] Platform data done.');
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🚀 LunarPad running at http://localhost:${PORT}\n`);
  seedDemoDecks().catch(console.error);
  seedPlatformData();
});

// 404 catch-all — proper error page
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(ROOT, 'public', '404.html'));
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
