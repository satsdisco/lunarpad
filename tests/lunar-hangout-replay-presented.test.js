const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('host can restage previously presented speakers for replay/testing', () => {
  const server = read('server.js');

  assert.match(server, /UPDATE speakers SET status = 'live' WHERE id = \?/);
  assert.match(server, /Speaker not found in this event/);
  assert.match(server, /current_speaker_id = \?, current_started_at = datetime\('now'\), status = 'live'/);
});

test('live lineup lets hosts click presented speakers to replay them', () => {
  const liveHtml = read('public', 'live.html');

  assert.match(liveHtml, /const isReplayable = isAdmin && s\.status !== 'skipped' && s\.status !== 'winner'/);
  assert.match(liveHtml, /roleLabel === 'NOW' \? ' active' : ''/);
  assert.match(liveHtml, /setSpeaker\('/);
  assert.match(liveHtml, /status === 'presented'/);
});
