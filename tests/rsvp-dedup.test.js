const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('RSVP route reuses legacy email rows and blocks duplicate authenticated signups', () => {
  const server = read('server.js');
  assert.match(server, /const normalizedEmail = email \? String\(email\)\.trim\(\)\.toLowerCase\(\) : null;/);
  assert.match(server, /SELECT id, user_id FROM rsvps WHERE event_id = \? AND \(user_id = \? OR lower\(email\) = \?\) ORDER BY created_at ASC/);
  assert.match(server, /UPDATE rsvps SET user_id = \?, name = \?, email = \? WHERE id = \?/);
  assert.match(server, /DELETE FROM rsvps WHERE event_id = \? AND id <> \? AND \(user_id = \? OR lower\(email\) = \?\)/);
  assert.match(server, /return res\.status\(409\)\.json\(\{ error: 'Already RSVP\\'d' \}\)/);
});

test('migration adds unique RSVP guards for user ids and emails', () => {
  const server = read('server.js');
  assert.match(server, /name: 'v022_rsvp_dedup_guards'/);
  assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_event_user_unique ON rsvps\(event_id, user_id\) WHERE user_id IS NOT NULL/);
  assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_event_email_unique ON rsvps\(event_id, lower\(email\)\) WHERE email IS NOT NULL/);
});
