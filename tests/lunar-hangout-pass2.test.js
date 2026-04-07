const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 2 live payload exposes timer and audience-stage guidance fields', () => {
  const server = read('server.js');

  assert.match(server, /time_remaining_seconds/);
  assert.match(server, /time_remaining_label/);
  assert.match(server, /stage_status_label/);
  assert.match(server, /lineup_groups/);
  assert.match(server, /upcoming:/);
  assert.match(server, /completed:/);
});

test('pass 2 live page renders timer and grouped lineup affordances', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="liveToolbarStrip"/);
  assert.match(html, /id="stageTimerValue"/);
  assert.match(html, /id="stageTimerMeta"/);
  assert.match(html, /id="lineupCurrent"/);
  assert.match(html, /id="lineupUpcoming"/);
  assert.match(html, /id="lineupCompleted"/);
  assert.match(html, /id="deckStatusNote"/);
  assert.match(html, /function renderLineupGroups/);
  assert.match(html, /function renderTimer/);
  assert.match(html, /setSpeaker\('/);
  assert.match(html, /\.live-toolbar-strip/);
});

test('pass 2 timer messaging covers live countdown and overtime/ended states', () => {
  const html = read('public', 'live.html');
  const server = read('server.js');

  assert.match(html, /Starts in|remaining|Time is up|Awaiting next presenter/);
  assert.match(server, /current_duration_minutes/);
  assert.match(server, /current_started_at/);
  assert.match(server, /Winner Pending/);
  assert.match(server, /Math\.max\(0/);
});
