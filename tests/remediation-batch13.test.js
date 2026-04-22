const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('mobile build layout uses a compact grid nav and trims onboarding density', () => {
  const css = read('public', 'css', 'style.css');

  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*grid-template-areas:\s*'brand actions'[\s\S]*'tabs tabs'/);
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.sidebar-nav \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.onboarding-shortcuts \{[\s\S]*display: none;/);
  assert.match(css, /\.project-deck-field-copy \{/);
  assert.match(css, /\.fab,[\s\S]*display: none !important;/);
});

test('foyer keeps the empty-state CTA but removes the extra explainer chrome', () => {
  const html = read('public', 'foyer.html');
  const css = read('public', 'css', 'style.css');

  assert.doesNotMatch(html, /id="foyerLegend"/);
  assert.doesNotMatch(html, /id="foyerGuidance"/);
  assert.match(html, /Post the first idea/);
  assert.match(html, /filters\.style\.display = 'none'/);
  assert.match(css, /\.foyer-empty-card \{/);
  assert.match(css, /\.foyer-empty-cta \{/);
  assert.match(css, /\.foyer-container \{[\s\S]*background: transparent;/);
});

test('decks filters and project deck attachment affordances are more discoverable', () => {
  const decksHtml = read('public', 'index.html');
  const buildHtml = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');

  assert.match(decksHtml, /decksTagBarWrap/);
  assert.match(decksHtml, /(?:Scroll|Swipe) to (?:browse )?more deck filters →/);
  assert.match(buildHtml, /recommended if you already uploaded a deck/);
  assert.match(buildHtml, /Pick one of your \$\{decks\.length\} uploaded presentation/);
  assert.match(css, /\.decks-tag-overflow-hint \{/);
  assert.match(css, /\.project-link-card \{/);
});
