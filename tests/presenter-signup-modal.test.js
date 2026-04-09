const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('event page renders presenter signup as a dedicated modal overlay', () => {
  const html = read('public', 'event.html');
  assert.match(html, /id="speakerSignupModal"/);
  assert.match(html, /class="modal-overlay" id="speakerSignupModal"/);
  assert.match(html, /function openSpeakerSignupModal\(\)/);
  assert.match(html, /function closeSpeakerSignupModal\(\)/);
  assert.match(html, /document\.getElementById\('speakerSignupModal'\)\?\.classList\.add\('open'\)/);
  assert.match(html, /document\.getElementById\('speakerSignupModal'\)\?\.classList\.remove\('open'\)/);
});

test('present CTAs open the modal instead of revealing and scrolling to inline signup content', () => {
  const html = read('public', 'event.html');
  assert.doesNotMatch(html, /signupSection'\)\.style\.display='block';document\.getElementById\('signupSection'\)\.scrollIntoView/);
  assert.doesNotMatch(html, /const s = document\.getElementById\('signupSection'\);\s*if \(s\) s\.style\.display = s\.style\.display === 'none' \? 'block' : 'none';/);
  assert.match(html, /presentToggle\) presentToggle\.onclick = openSpeakerSignupModal/);
});
