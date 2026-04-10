const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('project page lets owners add a presentation later by uploading or linking an existing deck', () => {
  const projectHtml = read('public', 'project.html');
  assert.match(projectHtml, /Link Existing Presentation/);
  assert.match(projectHtml, /fetch\('\/api\/decks\?limit=48'\)/);
  assert.match(projectHtml, /No presentations yet[\s\S]*Upload Presentation/);
  assert.match(projectHtml, /No presentations yet[\s\S]*Link Existing Presentation/);
});

test('project presentation version routes keep the project deck pointer synced to the current presentation', () => {
  const server = read('server.js');
  assert.match(server, /function syncProjectDeckPointer\(projectId, deckId\) \{/);
  assert.match(server, /app\.post\('\/api\/projects\/:id\/decks',[\s\S]*syncProjectDeckPointer\(req\.params\.id, deck_id\);/);
  assert.match(server, /app\.post\('\/api\/projects\/:id\/decks\/upload',[\s\S]*syncProjectDeckPointer\(req\.params\.id, deckId\);/);
  assert.match(server, /app\.patch\('\/api\/projects\/:id\/decks\/:version_id\/set-current',[\s\S]*syncProjectDeckPointer\(req\.params\.id, entry\.deck_id\);/);
  assert.match(server, /if \(entry\.is_current\) \{[\s\S]*syncProjectDeckPointer\(req\.params\.id, prev\.deck_id\);/);
});
