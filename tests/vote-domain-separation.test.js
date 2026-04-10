const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('server defines explicit helpers for content votes vs event-session speaker votes', () => {
  const server = read('server.js');

  assert.match(server, /function isContentVoteType\(type\)/);
  assert.match(server, /function isEventSessionVoteType\(type\)/);
  assert.match(server, /function isSupportedVoteType\(type\)/);
  assert.match(server, /if \(!isSupportedVoteType\(type\) \|\| !id\)/);
  assert.match(server, /toggleEventSessionVote\(type, id, voter, req\)/);
});

test('UI copy distinguishes persistent upvotes from event audience voting', () => {
  const projectHtml = read('public', 'project.html');
  const deckHtml = read('public', 'deck.html');
  const eventHtml = read('public', 'event.html');

  assert.match(projectHtml, />▲ Upvote</);
  assert.match(deckHtml, /title="Upvote this deck/);
  assert.match(eventHtml, /Audience vote for this presentation/);
  assert.match(eventHtml, /Audience vote stays session-specific/);
});
