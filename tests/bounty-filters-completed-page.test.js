const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('server exposes a dedicated completed bounties page route', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\('\/bounties\/completed',\s*requireAuth,\s*\(_, res\) => res\.sendFile\(path\.join\(ROOT, 'public', 'bounties-completed\.html'\)\)\);/);
});

test('build bounties view exposes label, status, and sats filters plus a completed-page link', () => {
  const buildHtml = read('public', 'build.html');
  assert.match(buildHtml, /id="bountyLabelFilter"/);
  assert.match(buildHtml, /id="bountyStatusFilter"/);
  assert.match(buildHtml, /id="bountySatsFilter"/);
  assert.match(buildHtml, /href="\/bounties\/completed"/);
  assert.match(buildHtml, /function filterBountiesForView\(/);
  assert.match(buildHtml, /function renderBountyFilters\(/);
});

test('completed bounties page has its own shell and reuses bounty filter controls', () => {
  const html = read('public', 'bounties-completed.html');
  assert.match(html, /Completed Bounties/);
  assert.match(html, /id="completedBountyGrid"/);
  assert.match(html, /id="completedBountyLabelFilter"/);
  assert.match(html, /id="completedBountyStatusFilter"/);
  assert.match(html, /id="completedBountySatsFilter"/);
  assert.match(html, /function loadCompletedBounties\(/);
  assert.match(html, /function filterCompletedBounties\(/);
});

test('bounty filters treat claimed and completed bounties as completed-page entries', () => {
  const buildHtml = read('public', 'build.html');
  const completedHtml = read('public', 'bounties-completed.html');
  assert.match(buildHtml, /return status === 'claimed' \|\| status === 'completed';/);
  assert.match(completedHtml, /return status === 'claimed' \|\| status === 'completed';/);
});
