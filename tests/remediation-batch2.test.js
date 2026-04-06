const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('event bounty cards provide a direct CTA to bounty detail pages', () => {
  const html = read('public', 'event.html');
  assert.match(html, /bounty-card-link/);
  assert.match(html, /View Bounty/);
  assert.match(html, /href="\/bounty\/\$\{esc\(b.id\)\}"/);
});

test('event hero buttons distinguish confirmed states from available actions', () => {
  const html = read('public', 'event.html');
  assert.match(html, /btn-confirmed/);
  assert.match(html, /✓ Going/);
  assert.match(html, /🎤 Presenting/);
  assert.match(html, /const userPresenting =/);
});

test('auth menu trigger includes an explicit chevron affordance and menu state wiring', () => {
  const js = read('public', 'js', 'auth.js');
  assert.match(js, /user-pill-chevron/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /syncUserMenuState/);
});

test('global nav active state is stronger than a bare underline', () => {
  const css = read('public', 'css', 'style.css');
  assert.match(css, /\.nav-tab\.active::after/);
  assert.match(css, /linear-gradient\(180deg, rgba\(124,92,252,0\.18\)/);
});
