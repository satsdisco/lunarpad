const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('leaderboard API supports offset/limit metadata for full browsing', () => {
  const server = read('server.js');
  assert.match(server, /const requestedOffset = Number\.parseInt\(req\.query\.offset, 10\);/);
  assert.match(server, /const requestedLimit = Number\.parseInt\(req\.query\.limit, 10\);/);
  assert.match(server, /const results = leaderboard\.slice\(offset, offset \+ limit\);/);
  assert.match(server, /has_more: offset \+ results\.length < total/);
  assert.match(server, /my_rank:/);
});

test('build page exposes hybrid leaderboard controls and current-rank copy', () => {
  const html = read('public', 'build.html');
  assert.match(html, /id="lbBrowseToggle"/);
  assert.match(html, /id="lbLoadMoreBtn"/);
  assert.match(html, /id="lbMyRank"/);
  assert.match(html, /Browse full leaderboard/);
  assert.match(html, /Your rank: #\$\{entry\.rank\}/);
});
