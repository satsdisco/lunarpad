const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('secondary event cards use static date labels instead of live countdown timers', () => {
  const buildHtml = read('public', 'build.html');
  const voteHtml = read('public', 'vote.html');
  const css = read('public', 'css', 'style.css');

  assert.match(buildHtml, /function formatSecondaryEventDateLabel/);
  assert.match(buildHtml, /class="event-secondary-date">\$\{esc\(secondaryDateLabel\)\}/);
  assert.doesNotMatch(buildHtml, /id="countdown-\$\{esc\(ev\.id\)\}"/);

  assert.match(voteHtml, /function formatStaticEventDate/);
  assert.match(voteHtml, /class="event-secondary-date">\$\{esc\(staticDateLabel\)\}/);
  assert.doesNotMatch(voteHtml, /id="vcd-d-\$\{esc\(ev\.id\)\}"/);

  assert.match(css, /\.event-secondary-date \{/);
});
