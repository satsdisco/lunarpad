const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('server creates a dedicated bounty_submissions table and migration', () => {
  const server = read('server.js');
  assert.match(server, /CREATE TABLE IF NOT EXISTS bounty_submissions \(/);
  assert.match(server, /submission_type TEXT NOT NULL DEFAULT 'mixed'/);
  assert.match(server, /content_markdown TEXT/);
  assert.match(server, /links_json TEXT/);
  assert.match(server, /review_notes TEXT/);
  assert.match(server, /updated_at DATETIME DEFAULT CURRENT_TIMESTAMP/);
  assert.match(server, /v026_bounty_submissions/);
});

test('bounty routes expose generic submission APIs and winner approval by submission id', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\('\/api\/bounties\/:id\/submissions'/);
  assert.match(server, /app\.get\('\/api\/bounty-submissions\/:id'/);
  assert.match(server, /app\.post\('\/api\/bounties\/:id\/submissions', requireAuth/);
  assert.match(server, /const \{ submission_id, winner_id, winner_name \} = req\.body;/);
  assert.match(server, /SELECT \* FROM bounty_submissions WHERE id = \? AND bounty_id = \? LIMIT 1/);
  assert.match(server, /Winner must be a submitted solution for this bounty/);
  assert.match(server, /UPDATE bounty_submissions SET status = 'winner_selected', updated_at = CURRENT_TIMESTAMP WHERE id = \?/);
});

test('bounty page uses a generic solution modal and admin review copy', () => {
  const bountyHtml = read('public', 'bounty.html');
  assert.match(bountyHtml, /Submission Type/);
  assert.match(bountyHtml, /Markdown\/Context File/);
  assert.match(bountyHtml, /Paste the markdown, context, or write-up here/);
  assert.match(bountyHtml, /fetch\('\/api\/bounties\/' \+ id \+ '\/submissions'\)/);
  assert.match(bountyHtml, /Review Submission/);
  assert.match(bountyHtml, /Approve Winner from Submission/);
  assert.doesNotMatch(bountyHtml, /Project Name/);
});

test('build page admin copy references submitted solutions instead of only participants', () => {
  const buildHtml = read('public', 'build.html');
  assert.match(buildHtml, /Only submitted solutions can win/);
  assert.match(buildHtml, /Select submitted solution/);
  assert.match(buildHtml, /submission_id: selectedSubmissionId/);
});
