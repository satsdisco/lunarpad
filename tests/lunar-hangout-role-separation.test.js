const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('live payload exposes viewer role and presenter slide-control permissions', () => {
  const server = read('server.js');

  assert.match(server, /function getLiveSessionPayload\(eventId, viewer = null\)/);
  assert.match(server, /viewer_role/);
  assert.match(server, /can_control_slides/);
  assert.match(server, /current\?\.user_id && viewer\?\.id && current\.user_id === viewer\.id/);
  assert.match(server, /viewer\?\.is_admin/);
});

test('live page adds presenter-only slide controls and hides host chrome from audience state', () => {
  const html = read('public', 'live.html');

  assert.match(html, /id="presenterControls"/);
  assert.match(html, /Previous Slide/);
  assert.match(html, /Next Slide/);
  assert.match(html, /function renderPresenterControls/);
  assert.match(html, /function sendSlideCommand/);
  assert.match(html, /viewer_role/);
  assert.doesNotMatch(html, /id="sessionStatePill"/);
  assert.doesNotMatch(html, /id="liveStatusDetail"/);
});
