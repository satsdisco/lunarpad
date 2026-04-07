const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 1 adds host control endpoints for voting and queue progression', () => {
  const server = read('server.js');

  assert.match(server, /app\.post\('\/api\/live\/:eventId\/open-voting'/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/close-voting'/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/advance'/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/mark-presented'/);
  assert.match(server, /app\.post\('\/api\/speakers\/:id\/skip'/);
  assert.match(server, /status = 'voting'/);
  assert.match(server, /status = 'presentations_complete'|status = 'winner_pending'/);
  assert.match(server, /Live session is not active/);
  assert.match(server, /Final voting can only open after all presentations are complete|No current speaker to open voting for/);
  assert.match(server, /Speaker not found in this event/);
  assert.match(server, /current_started_at = NULL/);
});

test('pass 1 gates live speaker voting to host-open windows only', () => {
  const server = read('server.js');

  assert.match(server, /SELECT ls\.voting_open, ls\.is_active, ls\.current_speaker_id/);
  assert.match(server, /speakerVotingState\.current_speaker_id === id/);
  assert.match(server, /Voting is closed for this speaker right now/);
  assert.match(server, /if \(type === 'speaker'\)/);
});

test('pass 1 live page exposes real host controls and session status rendering', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="viewerRoleChip"/);
  assert.match(html, /id="openVotingBtn"/);
  assert.match(html, /id="closeVotingBtn"/);
  assert.match(html, /id="advanceBtn"/);
  assert.match(html, /id="markPresentedBtn"/);
  assert.match(html, /id="skipSpeakerBtn"/);
  assert.match(html, /function renderAdminControls/);
  assert.match(html, /function openVoting\(\)/);
  assert.match(html, /function closeVoting\(\)/);
  assert.match(html, /function advanceSpeaker\(\)/);
  assert.match(html, /function markPresented\(\)/);
  assert.match(html, /api\/live\/\$\{eventId\}\/mark-presented/);
  assert.match(html, /function skipSpeaker\(\)/);
  assert.match(html, /data\.next_speaker/);
});
