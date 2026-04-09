const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('event API exposes an admin edit route with required time validation', () => {
  const server = read('server.js');
  assert.match(server, /app\.put\('\/api\/events\/:id', requireAuth, \(req, res\) => \{/);
  assert.match(server, /if \(!req\.user\?\.is_admin\) return res\.status\(403\)\.json\(\{ error: 'Admin access required' \}\)/);
  assert.match(server, /if \(!time\) return res\.status\(400\)\.json\(\{ error: 'time required' \}\)/);
  assert.match(server, /UPDATE events[\s\S]*SET name = \?, description = \?, event_type = \?, date = \?, time = \?, location = \?, virtual_link = \?/);
});

test('event detail page gives admins and organizers an edit path', () => {
  const html = read('public', 'event.html');
  assert.match(html, /function canEditEvent\(ev, currentUser\)/);
  assert.match(html, /id="eventEditModal"/);
  assert.match(html, /saveEventEdits\(\)/);
  assert.match(html, /function normalizeEventTimeInput\(rawValue\)/);
  assert.match(html, /placeholder="18:00 or 6:00pm"/);
  assert.match(html, /const time = normalizeEventTimeInput\(timeInput.value\)/);
  assert.match(html, /fetch\('\/api\/events\/' \+ eventId, \{/);
  assert.match(html, /method: 'PUT'/);
  assert.match(html, /id="operatorEditEventBtn"/);
  assert.match(html, /id="editEventBtn"/);
});
