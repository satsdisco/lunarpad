const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('bounty delete route allows admins or the creator and cleans related bounty rows', () => {
  const server = read('server.js');
  assert.match(server, /app\.delete\('\/api\/bounties\/:id', requireAuth, \(req, res\) => \{/);
  assert.match(server, /SELECT id, created_by FROM bounties WHERE id = \?/);
  assert.match(server, /if \(!bounty\) return res\.status\(404\)\.json\(\{ error: 'Not found' \}\);/);
  assert.match(server, /if \(!req\.user\.is_admin && bounty\.created_by !== req\.user\.id\) \{/);
  assert.match(server, /return res\.status\(403\)\.json\(\{ error: 'Not authorized' \}\);/);
  assert.match(server, /UPDATE projects SET bounty_id = NULL WHERE bounty_id = \?/);
  assert.match(server, /DELETE FROM bounty_submissions WHERE bounty_id = \?/);
  assert.match(server, /DELETE FROM bounty_payments WHERE bounty_id = \?/);
  assert.match(server, /DELETE FROM bounty_participants WHERE bounty_id = \?/);
  assert.match(server, /DELETE FROM bounties WHERE id = \?/);
});

test('bounty detail page exposes creator-or-admin delete controls', () => {
  const bountyHtml = read('public', 'bounty.html');
  assert.match(bountyHtml, /const canDeleteBounty = !!\(me\.user && \(isAdmin \|\| b\.created_by === me\.user\.id\)\);/);
  assert.match(bountyHtml, /Delete Bounty/);
  assert.match(bountyHtml, /onclick="deleteBounty\('\$\{esc\(b\.id\)\}'\)"/);
  assert.match(bountyHtml, /async function deleteBounty\(bountyId\) \{/);
  assert.match(bountyHtml, /fetch\('\/api\/bounties\/' \+ bountyId, \{ method: 'DELETE' \}\)/);
  assert.match(bountyHtml, /window\.location\.href = '\/build';/);
});
