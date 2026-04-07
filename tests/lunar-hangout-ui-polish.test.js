const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('live page uses stronger disabled vote styling and explicit truncation guards', () => {
  const html = read('public', 'live.html');

  assert.match(html, /\.live-vote-btn:disabled \{/);
  assert.match(html, /filter: saturate\(0\.35\)/);
  assert.match(html, /cursor: not-allowed/);
  assert.match(html, /\.live-current-name \{/);
  assert.match(html, /text-overflow: ellipsis/);
  assert.match(html, /\.live-current-project \{/);
  assert.match(html, /title="\$\{esc\(s\.name\)\}"/);
  assert.match(html, /title="\$\{esc\(s\.project_title \|\| s\.project \|\| ''\)\}"/);
});

test('live page replaces native end-session confirm with in-app confirm modal', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="endSessionModal"/);
  assert.match(html, /function openEndSessionModal/);
  assert.match(html, /function closeEndSessionModal/);
  assert.match(html, /function confirmStopSession/);
  assert.doesNotMatch(html, /confirm\('End the live session\?'\)/);
});
