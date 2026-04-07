const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('build onboarding passes profile setup intent into profile', () => {
  const html = read('public', 'build.html');
  assert.match(html, /window\.location\.href = '\/profile\?onboarding=1'/);
});

test('profile page renders an onboarding-aware setup card with direct setup actions', () => {
  const html = read('public', 'profile.html');
  const css = read('public', 'css', 'style.css');

  assert.match(html, /function hasProfileOnboardingIntent/);
  assert.match(html, /function clearProfileOnboardingIntent/);
  assert.match(html, /function getProfileOnboardingChecklist/);
  assert.match(html, /function focusProfileOnboardingAction/);
  assert.match(html, /function renderProfileOnboardingCard/);
  assert.match(html, /Finish your profile setup/);
  assert.match(html, /Onboarding handoff/);
  assert.match(html, /Back to Build/);
  assert.match(html, /Hide setup guide/);
  assert.match(html, /Edit bio/);
  assert.match(html, /Add links/);
  assert.match(html, /Add lightning/);
  assert.match(html, /Set availability/);
  assert.match(html, /\$\{onboardingCard\}/);

  assert.match(css, /\.profile-onboarding-card \{/);
  assert.match(css, /\.profile-onboarding-head \{/);
  assert.match(css, /\.profile-onboarding-steps \{/);
  assert.match(css, /\.profile-onboarding-step \{/);
  assert.match(css, /\.profile-onboarding-actions \{/);
});
