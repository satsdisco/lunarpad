const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('notifications dropdown includes a View all path and dedicated inbox page exists', () => {
  const authJs = read('public', 'js', 'auth.js');
  const inboxHtml = read('public', 'notifications.html');
  const server = read('server.js');

  assert.match(authJs, /View all/);
  assert.match(authJs, /href="\/notifications"/);
  assert.match(inboxHtml, /Notifications Inbox/);
  assert.match(inboxHtml, /id="notificationsHistory"/);
  assert.match(server, /app\.get\('\/notifications', requireAuth/);
});

test('notifications API supports paginated history beyond the dropdown preview', () => {
  const server = read('server.js');
  assert.match(server, /getNotificationsPage/);
  assert.match(server, /LIMIT \? OFFSET \?/);
  assert.match(server, /const limit = Math\.min\(Math\.max\(Number\.parseInt\(req\.query\.limit/);
});

test('build sidebar has clearer hierarchy with a labeled navigation shell', () => {
  const html = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');

  assert.match(html, /sidebar-title">Build in Public/);
  assert.match(html, /sidebar-intro/);
  assert.match(html, /sidebar-link-kicker/);
  assert.match(css, /\.build-sidebar-shell/);
  assert.match(css, /\.sidebar-intro/);
});

test('build floating action button is contextual to the active section instead of static', () => {
  const html = read('public', 'build.html');

  assert.match(html, /id="contextualFab"/);
  assert.match(html, /function getFabConfigForView/);
  assert.match(html, /switchToView\(viewName, options = \{\}\)/);
  assert.match(html, /Submit to Bounty/);
  assert.match(html, /Present Project/);
  assert.doesNotMatch(html, /title="Submit Project" onclick="document\.getElementById\('projectModal'\)\.classList\.add\('open'\)"/);
});
