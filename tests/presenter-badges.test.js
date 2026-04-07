const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('server tracks scheduled vs presented speaker state', () => {
  const server = read('server.js');
  assert.match(server, /v019_speaker_presented_state/);
  assert.match(server, /v021_speaker_schedule_repair/);
  assert.match(server, /ALTER TABLE speakers ADD COLUMN presented_at TEXT/);
  assert.match(server, /ALTER TABLE speakers ADD COLUMN scheduled_at TEXT/);
  assert.match(server, /ALTER TABLE speakers ADD COLUMN status TEXT DEFAULT 'scheduled'/);
});

test('presenter badge is awarded only from confirmed presented speakers', () => {
  const server = read('server.js');
  assert.match(server, /WHERE s\.user_id = \? AND s\.presented_at IS NOT NULL/);
  assert.doesNotMatch(server, /SELECT id FROM speakers WHERE name = \?/);
});

test('profile renders an upcoming presenter state separately from permanent presenter', () => {
  const profile = read('public', 'profile.html');
  assert.match(profile, /Upcoming Presenter/);
  assert.match(profile, /profile-scheduled-badge-pill/);
});

test('event page exposes admin controls to confirm a speaker actually presented', () => {
  const eventHtml = read('public', 'event.html');
  assert.match(eventHtml, /markSpeakerPresented/);
  assert.match(eventHtml, /Mark Presented/);
  assert.match(eventHtml, /Presented ✓/);
});
