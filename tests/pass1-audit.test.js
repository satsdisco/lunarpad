const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

let uiRules;
try {
  uiRules = require(path.join(ROOT, 'public/js/ui-rules.js'));
} catch {
  uiRules = null;
}

test('ui rules module exists', () => {
  assert.ok(uiRules, 'expected public/js/ui-rules.js to exist and export helpers');
});

test('public leaderboard filters obvious demo/test users', () => {
  assert.ok(uiRules?.filterPublicLeaderboardRows, 'expected filterPublicLeaderboardRows helper');
  const rows = [
    { user_id: '1', name: 'Alice' },
    { user_id: '2', name: 'Demo User' },
    { user_id: '3', name: 'test account' },
  ];
  assert.deepEqual(
    uiRules.filterPublicLeaderboardRows(rows).map((row) => row.name),
    ['Alice']
  );
});

test('recap CTA only appears when an event has actual recap-worthy speaker content', () => {
  assert.ok(uiRules?.shouldShowEventRecap, 'expected shouldShowEventRecap helper');
  assert.equal(uiRules.shouldShowEventRecap({ speakers: [] }), false);
  assert.equal(uiRules.shouldShowEventRecap({ speakers: [{ id: 'spk-1' }] }), false);
  assert.equal(uiRules.shouldShowEventRecap({ result_summary: { id: 'res-1' } }), true);
});

test('availability display helpers keep unset values blank but preserve explicit zero', () => {
  assert.ok(uiRules?.getAvailabilityInputValue, 'expected getAvailabilityInputValue helper');
  assert.equal(uiRules.getAvailabilityInputValue(null), '');
  assert.equal(uiRules.getAvailabilityInputValue(undefined), '');
  assert.equal(uiRules.getAvailabilityInputValue(0), '0');
  assert.equal(uiRules.getAvailabilityPlaceholder(null), 'Set hours');
  assert.equal(uiRules.getAvailabilityPlaceholder(0), '');
});

test('Decks page has a page-specific title', () => {
  const html = read('public', 'index.html');
  assert.match(html, /<title>Decks — LunarPad<\/title>/);
});

test('homepage hero RSVP is implemented as an action button, not a duplicate event link', () => {
  const html = read('public', 'build.html');
  assert.doesNotMatch(
    html,
    /<a href="\/event\/\$\{esc\(ev\.id\)\}" class="btn"[^>]*>RSVP<\/a>/
  );
  assert.match(html, /onclick="toggleHeroRsvp\(\)"/);
});

test('past event recap affordance is conditional', () => {
  const html = read('public', 'build.html');
  assert.match(html, /shouldShowEventRecap\(ev\)/);
});

test('event detail page surfaces attendee visibility beyond the hero count', () => {
  const eventHtml = read('public', 'event.html');
  const server = read('server.js');

  assert.match(server, /LEFT JOIN users u ON r\.user_id = u\.id/);
  assert.match(eventHtml, /function renderAttendeesSection/);
  assert.match(eventHtml, /event-attendees-card/);
  assert.match(eventHtml, /See who is already in the room before you RSVP or present/);
});

test('profile availability input uses a friendly placeholder', () => {
  const html = read('public', 'profile.html');
  assert.match(html, /placeholder="Set hours"/);
  assert.doesNotMatch(html, /placeholder="0"/);
});
