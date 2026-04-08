const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('events carousel counter is more explicit and navigable', () => {
  const html = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');
  assert.match(html, /Browse events/);
  assert.match(html, /Event 1 of/);
  assert.match(html, /event-carousel-toolbar/);
  assert.match(css, /\.carousel-counter-label/);
  assert.match(css, /\.event-carousel-toolbar/);
});

test('mini calendar cells expose clearer event affordance with markers and labels', () => {
  const html = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');
  assert.match(html, /cal-event-markers/);
  assert.match(html, /aria-label=/);
  assert.match(css, /\.cal-event-dot/);
});

test('deck detail actions are grouped for cleaner wrapping on narrow widths', () => {
  const html = read('public', 'deck.html');
  const css = read('public', 'css', 'style.css');
  assert.match(html, /viewer-actions-group-primary/);
  assert.match(html, /viewer-actions-group-links/);
  assert.match(css, /\.viewer-actions-group/);
});

test('bounty deadline formatting and styles support urgency-aware tones', () => {
  const bountyHtml = read('public', 'bounty.html');
  const css = read('public', 'css', 'style.css');
  assert.match(bountyHtml, /tone: 'urgent'/);
  assert.match(bountyHtml, /tone: 'soon'/);
  assert.match(css, /\.deadline-chip\.soon/);
  assert.match(css, /\.deadline-chip\.urgent/);
});

test('completed bounty cards suppress boost actions and contributor chips are deduplicated', () => {
  const buildHtml = read('public', 'build.html');
  const bountyHtml = read('public', 'bounty.html');
  assert.match(buildHtml, /const boostAction = b\.status === 'completed'/);
  assert.match(bountyHtml, /const recentContributors = confirmedPayments\.filter/);
  assert.match(bountyHtml, /paymentKey/);
});

test('project presentations tab shows an explicit empty state when no deck exists', () => {
  const projectHtml = read('public', 'project.html');
  assert.match(projectHtml, /function renderPresentationsEmptyState/);
  assert.match(projectHtml, /No presentations yet/);
  assert.match(projectHtml, /Upload the first presentation version to populate this tab/);
});

test('bounty timeline inactive steps and create bounty CTA have stronger visual treatment', () => {
  const buildHtml = read('public', 'build.html');
  const css = read('public', 'style.css');
  assert.match(buildHtml, /create-bounty-cta/);
  assert.match(css, /\.create-bounty-cta/);
  assert.match(css, /\.timeline-step\.pending \.timeline-label/);
  assert.match(css, /\.timeline-step\.pending \.timeline-dot/);
});

test('event countdowns and event selection use exact scheduled start datetimes', () => {
  const buildHtml = read('public', 'build.html');
  const eventHtml = read('public', 'event.html');
  const server = read('server.js');
  assert.match(buildHtml, /function getEventStartDate\(/);
  assert.match(buildHtml, /new Date\(ev\.date \+ \('T' \+ ev\.time\)\)/);
  assert.match(buildHtml, /if \(!name \|\| !date \|\| !time\) return alert\('Name, date, and time required'\)/);
  assert.match(eventHtml, /function getEventStartDate\(/);
  assert.match(eventHtml, /const eventDate = getEventStartDate\(eventData\)/);
  assert.match(server, /if \(!time\) return res\.status\(400\)\.json\(\{ error: 'time required' \}\)/);
});

test('bounty cards show explicit deadline or expiration state instead of raw dates only', () => {
  const buildHtml = read('public', 'build.html');
  assert.match(buildHtml, /function formatBountyDeadlineState\(/);
  assert.match(buildHtml, /Deadline passed:/);
  assert.match(buildHtml, /Due today/);
  assert.match(buildHtml, /class=\"bounty-deadline \$\{deadlineState\.tone\}\"/);
});

test('projects view makes tag overflow discoverable and uses stronger repo demo labels', () => {
  const buildHtml = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');
  assert.match(buildHtml, /projectTagBarWrap/);
  assert.match(buildHtml, /projectTagOverflowHint/);
  assert.match(buildHtml, /Repository ↗/);
  assert.match(buildHtml, /Live Demo ↗/);
  assert.match(css, /\.tag-bar-wrap/);
  assert.match(css, /\.tag-overflow-hint/);
});

test('projects sparse states and project detail explain status and support actions', () => {
  const buildHtml = read('public', 'build.html');
  const projectHtml = read('public', 'project.html');
  assert.match(buildHtml, /projectsSparseCta/);
  assert.match(buildHtml, /Submit your first project/);
  assert.match(projectHtml, /statusLegend/);
  assert.match(projectHtml, /Support guide:/);
  assert.match(projectHtml, /Upvote signals interest/);
  assert.match(projectHtml, /Zap sats sends bitcoin support/);
});
