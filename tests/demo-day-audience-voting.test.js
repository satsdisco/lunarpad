const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('server stores a separate event-scoped audience vote and gates admin page server-side', () => {
  const server = read('server.js');

  assert.match(server, /CREATE TABLE IF NOT EXISTS event_audience_votes/);
  assert.match(server, /CREATE UNIQUE INDEX IF NOT EXISTS idx_event_audience_votes_one_per_user/);
  assert.match(server, /ALTER TABLE events ADD COLUMN audience_voting_open INTEGER DEFAULT 0/);
  assert.match(server, /app\.get\('\/admin',\s+requireAuth, requireAdmin/);
});

test('server exposes admin open\/close routes and one-vote-per-event audience vote casting', () => {
  const server = read('server.js');

  assert.match(server, /app\.post\('\/api\/events\/:id\/audience-vote\/open', requireAuth, requireAdmin/);
  assert.match(server, /app\.post\('\/api\/events\/:id\/audience-vote\/close', requireAuth, requireAdmin/);
  assert.match(server, /app\.post\('\/api\/events\/:id\/audience-vote', requireAuth/);
  assert.match(server, /Audience voting is not open for this event/);
  assert.match(server, /You have already voted in this event/);
});

test('event page separates lineup support upvotes from post-event audience winner voting', () => {
  const eventHtml = read('public', 'event.html');

  assert.match(eventHtml, /function renderAudienceVoteSection\(ev, currentUser\)/);
  assert.match(eventHtml, /Post-event winner vote/);
  assert.match(eventHtml, /Open winner voting/);
  assert.match(eventHtml, /The upvotes in the lineup do not decide the winner/);
  assert.match(eventHtml, /Upvote for lineup support\. This does not decide the event winner\./);
  assert.match(eventHtml, /Use this upvote for lineup support only\./);
});
