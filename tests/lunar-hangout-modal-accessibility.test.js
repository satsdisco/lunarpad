const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('live zap modal supports standard dismissal affordances', () => {
  const html = read('public', 'live.html');

  assert.match(html, /function handleZapModalBackdropClick/);
  assert.match(html, /if \(event\.target === event\.currentTarget\) closeZapModal\(\)/);
  assert.match(html, /function handleZapModalKeydown/);
  assert.match(html, /event\.key === 'Escape'/);
  assert.match(html, /document\.addEventListener\('keydown', handleZapModalKeydown\)/);
  assert.match(html, /onclick="handleZapModalBackdropClick\(event\)"/);
});

test('live zap modal preset buttons have a visibly stronger active state hook', () => {
  const html = read('public', 'live.html');

  assert.match(html, /\.sats-preset-btn\.active,/);
  assert.match(html, /box-shadow:/);
  assert.match(html, /transform: translateY\(-1px\)/);
  assert.match(html, /setZapAmount\(/);
});
