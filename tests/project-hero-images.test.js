const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('project hero pipeline defines explicit normalization constants and helper', () => {
  const server = read('server.js');
  assert.match(server, /const PROJECT_HERO_WIDTH = 1600;/);
  assert.match(server, /const PROJECT_HERO_HEIGHT = 900;/);
  assert.match(server, /async function normalizeProjectHeroImage\(filePath\) \{/);
  assert.match(server, /await normalizeProjectHeroImage\(destPath\);/);
});

test('project hero media uses a reusable 16:9 wrapper and consistent object positioning', () => {
  const css = read('public', 'css', 'style.css');
  const buildHtml = read('public', 'build.html');
  const profileHtml = read('public', 'profile.html');

  assert.match(css, /\.project-card-media \{[\s\S]*aspect-ratio:\s*16\s*\/\s*9;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.project-card-visual \{[\s\S]*height:\s*100%;[\s\S]*object-fit:\s*cover;[\s\S]*object-position:\s*center center;/);
  assert.match(buildHtml, /class="project-card-media"/);
  assert.match(profileHtml, /class="project-card-media"/);
});
