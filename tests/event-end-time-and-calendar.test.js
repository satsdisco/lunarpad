const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('event schema and API support optional end time with resolved UTC end instant', () => {
  const server = read('server.js');
  assert.match(server, /end_time\s+TEXT/);
  assert.match(server, /ends_at_utc\s+TEXT/);
  assert.match(server, /const \{ name, description, event_type, date, time, end_time, event_timezone, location, virtual_link \} = req\.body;/);
  assert.match(server, /const endsAtUtc = end_time \? resolveEventStartUtc\(date, end_time, eventTimezone\) : null;/);
  assert.match(server, /INSERT INTO events \(id, name, description, event_type, date, time, end_time, event_timezone, starts_at_utc, ends_at_utc, location, virtual_link\)/);
  assert.match(server, /SET name = \?, description = \?, event_type = \?, date = \?, time = \?, end_time = \?, event_timezone = \?, starts_at_utc = \?, ends_at_utc = \?, location = \?, virtual_link = \?/);
});

test('event create and edit forms expose end time controls', () => {
  const adminHtml = read('public', 'admin.html');
  const eventHtml = read('public', 'event.html');
  assert.match(adminHtml, /id="e-end-time"/);
  assert.match(eventHtml, /id="editEventEndTime"/);
  assert.match(eventHtml, /const endTimeInput = document\.getElementById\('editEventEndTime'\);/);
  assert.match(eventHtml, /const end_time = endTimeInput && endTimeInput.value \? normalizeEventTimeInput\(endTimeInput.value\) : '';/);
});

test('event page calendar link uses provided end time instead of hard-coded duration', () => {
  const eventHtml = read('public', 'event.html');
  assert.match(eventHtml, /const endDate = ev\.ends_at_utc \? new Date\(ev\.ends_at_utc\) : \(ev\.end_time \? getEventEndDate\(ev\) : new Date\(startDate\.getTime\(\) \+ \(2 \* 60 \* 60 \* 1000\)\)\);/);
  assert.doesNotMatch(eventHtml, /const endDate = new Date\(startDate\.getTime\(\) \+ \(2 \* 60 \* 60 \* 1000\)\);/);
});

test('event page hero no longer renders the long inline meta row with local-time copy', () => {
  const eventHtml = read('public', 'event.html');
  assert.doesNotMatch(eventHtml, /<div class="event-hero-meta">/);
  assert.doesNotMatch(eventHtml, /🌍 \$\{esc\(localizedViewerTime\)\}/);
});

test('upcoming events page no longer renders verbose date-time-location meta rows', () => {
  const buildHtml = read('public', 'build.html');
  assert.doesNotMatch(buildHtml, /<div class="event-hero-meta">🗓 \$\{esc\(dateStr\)\}/);
  assert.doesNotMatch(buildHtml, /<div class="event-details" style="margin-top:8px"><span>🗓 \$\{esc\(dateStr\)\}<\/span>/);
});
