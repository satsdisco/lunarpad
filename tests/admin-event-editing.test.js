const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('event API exposes an edit route gated by event-edit capability', () => {
  const server = read('server.js');
  assert.match(server, /app\.put\('\/api\/events\/:id', requireAuth, requireEventCapability\('event\.edit', 'id'\), \(req, res\) => \{/);
  assert.match(server, /if \(!time\) return res\.status\(400\)\.json\(\{ error: 'time required' \}\)/);
  assert.match(server, /UPDATE events[\s\S]*SET name = \?, description = \?, event_type = \?, date = \?, time = \?, location = \?, virtual_link = \?/);
});

test('event detail page gives admins and organizers an edit path', () => {
  const html = read('public', 'event.html');
  assert.match(html, /function canEditEvent\(ev, currentUser\)/);
  assert.match(html, /id="eventEditModal"/);
  assert.match(html, /saveEventEdits\(\)/);
  assert.match(html, /fetch\('\/api\/events\/' \+ eventId, \{/);
  assert.match(html, /method: 'PUT'/);
  assert.match(html, /id="operatorEditEventBtn"/);
  assert.match(html, /id="editEventBtn"/);
});
