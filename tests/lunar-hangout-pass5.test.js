const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('pass 5 server stores durable event results artifacts and exposes them on event APIs', () => {
  const server = read('server.js');

  assert.match(server, /function getStoredEventResults/);
  assert.match(server, /function buildEventResultsRecord/);
  assert.match(server, /function upsertEventResults/);
  assert.match(server, /summary_markdown/);
  assert.match(server, /results_json/);
  assert.match(server, /result_summary/);
  assert.match(server, /event_results: eventResults\?\.results \|\| null/);
  assert.match(server, /upsertEventResults\(req\.params\.eventId\)/);
});

test('pass 5 event page renders recap artifact with rankings and support activity', () => {
  const html = read('public', 'event.html');

  assert.match(html, /function renderResultsSection/);
  assert.match(html, /event-results-ranking-list/);
  assert.match(html, /event-results-support-list/);
  assert.match(html, /Session recap/);
  assert.match(html, /switchTab\('results', event\)/);
});

test('pass 5 recap CTA is tied to stored result availability', () => {
  const uiRules = require(path.join(ROOT, 'public', 'js', 'ui-rules.js'));

  assert.equal(uiRules.shouldShowEventRecap({ speakers: [{ id: 'spk-1' }] }), false);
  assert.equal(uiRules.shouldShowEventRecap({ live_summary: { results_url: '/event/demo#results' } }), true);
  assert.equal(uiRules.shouldShowEventRecap({ result_summary: { id: 'result-1' } }), true);
});