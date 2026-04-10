const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('server exposes explicit helper wrappers for content votes and event-session speaker votes', () => {
  assert.match(server, /function getVoteActorId\(req\)/);
  assert.match(server, /function getVoteState\(type, id, voter\)/);
  assert.match(server, /function toggleContentVote\(type, id, voter, req\)/);
  assert.match(server, /function toggleEventSessionVote\(type, id, voter, req\)/);
  assert.match(server, /function getVoteStateMap\(type, ids, voter\)/);
});

test('unified vote routes use the domain-specific helper wrappers', () => {
  assert.match(server, /const voter = getVoteActorId\(req\);/);
  assert.match(server, /const voteResult = isEventSessionVoteType\(type\)\s*\? toggleEventSessionVote\(type, id, voter, req\)\s*:\s*toggleContentVote\(type, id, voter, req\);/);
  assert.match(server, /const voteState = getVoteState\(type, id, voter\);/);
  assert.match(server, /const result = getVoteStateMap\(type, idList, voter\);/);
});
