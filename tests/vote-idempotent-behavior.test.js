const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('content votes are idempotent add-only so repeat upvotes do not silently erase counts', () => {
  assert.match(server, /function toggleContentVote\(type, id, voter, req\) \{/);
  assert.match(server, /if \(existing\) \{\s*return \{ \.\.\.getVoteState\(type, id, voter\), voted: true \};\s*\}/);
  assert.doesNotMatch(server, /function toggleContentVote\([\s\S]*?stmts\.removeVote\.run\(type, id, voter\);/);
});

test('event session speaker votes are also idempotent once cast', () => {
  assert.match(server, /function toggleEventSessionVote\(type, id, voter, req\) \{/);
  assert.match(server, /if \(existing\) \{\s*return \{ \.\.\.getVoteState\(type, id, voter\), voted: true \};\s*\}/);
  assert.doesNotMatch(server, /function toggleEventSessionVote\([\s\S]*?stmts\.removeVote\.run\(type, id, voter\);/);
});
