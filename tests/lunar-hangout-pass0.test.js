const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 0 adds durable lunar hangout session and results schema fields', () => {
  const server = read('server.js');

  assert.match(server, /v020_lunar_hangout_phase0/);
  assert.match(server, /ALTER TABLE live_sessions ADD COLUMN mode TEXT DEFAULT 'demo-day-live'/);
  assert.match(server, /ALTER TABLE live_sessions ADD COLUMN status TEXT DEFAULT 'idle'/);
  assert.match(server, /ALTER TABLE live_sessions ADD COLUMN voting_open INTEGER DEFAULT 0/);
  assert.match(server, /ALTER TABLE live_sessions ADD COLUMN winner_speaker_id TEXT/);
  assert.match(server, /ALTER TABLE live_sessions ADD COLUMN payout_status TEXT DEFAULT 'pending'/);
  assert.match(server, /ALTER TABLE speakers ADD COLUMN queue_position INTEGER/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS event_results/);
});

test('pass 0 extracts a coherent live session payload helper with queue and scoreboard state', () => {
  const server = read('server.js');

  assert.match(server, /function getOrderedEventSpeakers\(eventId\)/);
  assert.match(server, /function getLiveSessionPayload\(eventId\)/);
  assert.match(server, /next_speaker/);
  assert.match(server, /scoreboard/);
  assert.match(server, /meet_url/);
  assert.match(server, /results_url/);
  assert.match(server, /ORDER BY COALESCE\(s.queue_position, 2147483647\) ASC/);
});

test('pass 0 routes reuse the shared payload helper and initialize richer session defaults', () => {
  const server = read('server.js');

  assert.match(server, /const payload = getLiveSessionPayload\(req.params.eventId\);/);
  assert.match(server, /INSERT INTO live_sessions \(id, event_id, is_active, mode, status, voting_open, payout_status, meet_url\)/);
  assert.match(server, /UPDATE live_sessions SET is_active = 1, current_speaker_id = NULL, current_started_at = NULL,[\s\S]*status = 'live'/);
  assert.match(server, /UPDATE live_sessions SET is_active = 0, current_speaker_id = NULL, voting_open = 0, status = 'completed'/);
  assert.match(server, /current_started_at = datetime\('now'\)/);
});
