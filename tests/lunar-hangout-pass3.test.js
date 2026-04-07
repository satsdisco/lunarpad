const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 3 live flow supports end-of-event-only voting states and live speaker zaps', () => {
  const server = read('server.js');

  assert.match(server, /presentations_complete/);
  assert.match(server, /All Presentations Complete/);
  assert.match(server, /Voting is now open/);
  assert.match(server, /speakerVotingState\.status === 'voting' && !speakerVotingState\.current_speaker_id/);
  assert.match(server, /speakerVotingState\.speaker_status !== 'skipped'/);
  assert.match(server, /app\.post\('\/api\/speakers\/:id\/zap'/);
  assert.match(server, /app\.get\('\/api\/speakers\/:id\/zaps'/);
  assert.match(server, /target_type = 'speaker'/);
  assert.match(server, /zap_leader/);
  assert.match(server, /recent_support/);
});

test('pass 3 live page adds bitcoin-native zap support and deeper scoreboard treatment', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="viewerRoleChip"/);
  assert.match(html, /function setStatus/);
  assert.match(html, /id="finalVotingPanel"/);
  assert.match(html, /id="finalVotingGrid"/);
  assert.match(html, /function renderFinalVoting/);
  assert.match(html, /function voteForSpeaker\(speakerId\)/);
  assert.match(html, /Open Final Voting/);
  assert.match(html, /id="zapBtn"/);
  assert.match(html, /function openZapModal/);
  assert.match(html, /function generateSpeakerZapInvoice/);
  assert.match(html, /id="scoreboardLeaderVotes"/);
  assert.match(html, /id="scoreboardLeaderSats"/);
  assert.match(html, /id="scoreboardSupportList"/);
  assert.match(html, /⚡ Zap/);
  assert.doesNotMatch(html, /<div class="live-waiting" id="waitingScreen">/);
});
