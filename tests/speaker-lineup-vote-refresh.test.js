const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const eventHtml = fs.readFileSync(path.join(ROOT, 'public', 'event.html'), 'utf8');

test('speaker lineup vote totals are actively refreshed on the event page', () => {
  assert.match(eventHtml, /let speakerVotePollInterval = null;/);
  assert.match(eventHtml, /function stopSpeakerVotePolling\(\)/);
  assert.match(eventHtml, /function startSpeakerVotePolling\(speakers\)/);
  assert.match(eventHtml, /speakerVotePollInterval = setInterval\(/);
  assert.match(eventHtml, /hydrateSpeakerVoteState\(speakers\)/);
});

test('speaker lineup vote polling pauses when the page is hidden', () => {
  assert.match(eventHtml, /document\.addEventListener\('visibilitychange'/);
  assert.match(eventHtml, /if \(document\.hidden\) \{/);
  assert.match(eventHtml, /stopSpeakerVotePolling\(\);/);
});
