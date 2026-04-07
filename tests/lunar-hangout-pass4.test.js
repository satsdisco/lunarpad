const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 4 server exposes winner recommendation and host confirmation endpoints', () => {
  const server = read('server.js');

  assert.match(server, /function getRecommendedWinner/);
  assert.match(server, /winner_recommendation/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/confirm-winner'/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/confirm-payout'/);
  assert.match(server, /app\.post\('\/api\/live\/:eventId\/mark-payout-sent'/);
  assert.match(server, /winner_speaker_id/);
  assert.match(server, /winner_confirmed_at/);
  assert.match(server, /payout_status/);
});

test('pass 4 live page renders recommended winner and payout status controls', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="winnerPanel"/);
  assert.match(html, /id="winnerRecommendation"/);
  assert.match(html, /id="winnerPayoutStatus"/);
  assert.match(html, /Confirm Winner/);
  assert.match(html, /Confirm Payout/);
  assert.match(html, /Mark Paid/);
  assert.match(html, /function renderWinnerPanel/);
  assert.match(html, /function confirmWinner/);
  assert.match(html, /function confirmPayout/);
});

test('pass 4 event page shows public winner and payout states', () => {
  const html = read('public', 'event.html');
  const server = read('server.js');

  assert.match(server, /live_summary/);
  assert.match(html, /event-results-card/);
  assert.match(html, /winner confirmed/i);
  assert.match(html, /payout pending/i);
  assert.match(html, /payout sent/i);
});
