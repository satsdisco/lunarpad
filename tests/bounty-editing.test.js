const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('bounty schema and create route retain bounty creator ownership', () => {
  const server = read('server.js');
  assert.match(server, /ALTER TABLE bounties ADD COLUMN created_by TEXT/);
  assert.match(server, /const \{ title, description, sats_amount, sats, deadline, status, tags, event_id \} = req\.body;/);
  assert.match(server, /INSERT INTO bounties \(id, title, description, sats_amount, deadline, status, tags, event_id, created_by\)/);
  assert.match(server, /event_id \|\| null,\s*req\.user\.id/);
});

test('server exposes a creator-or-admin bounty edit route with optional event relinking', () => {
  const server = read('server.js');
  assert.match(server, /app\.put\('\/api\/bounties\/:id', requireAuth, \(req, res\) => \{/);
  assert.match(server, /if \(!req\.user\.is_admin && bounty\.created_by !== req\.user\.id\) return res\.status\(403\)\.json\(\{ error: 'Not authorized' \}\);/);
  assert.match(server, /const \{ title, description, sats_amount, deadline, tags, event_id \} = req\.body;/);
  assert.match(server, /const linkedEvent = event_id \? db\.prepare\('SELECT id FROM events WHERE id = \?'\)\.get\(event_id\) : null;/);
  assert.match(server, /UPDATE bounties SET title = \?, description = \?, sats_amount = \?, deadline = \?, tags = \?, event_id = \? WHERE id = \?/);
});

test('bounty detail page exposes an edit modal with linked-event selection for the owner', () => {
  const html = read('public', 'bounty.html');
  assert.match(html, /id="editBountyModal"/);
  assert.match(html, /id="editBountyEvent"/);
  assert.match(html, /function openEditBountyModal\(bounty\)/);
  assert.match(html, /await fetch\('\/api\/events'\)/);
  assert.match(html, /saveBountyEdits\(bountyId\)/);
  assert.match(html, /Edit Bounty/);
});
