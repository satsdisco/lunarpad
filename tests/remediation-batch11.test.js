const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('build page includes a dismissible first-visit onboarding panel with quick actions', () => {
  const html = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');

  assert.match(html, /id="firstVisitPanel"/);
  assert.match(html, /Welcome to LunarPad/);
  assert.match(html, /id="onboardingNameSuffix"/);
  assert.match(html, /Start with Events/);
  assert.match(html, /Suggested first steps/);
  assert.match(html, /See what is live/);
  assert.match(html, /Projects/);
  assert.match(html, /Bounties/);
  assert.match(html, /The Foyer/);
  assert.match(html, /Skip/);
  assert.match(html, /const FIRST_VISIT_PANEL_KEY = 'lunarpad:first-visit-panel:dismissed:v2'/);
  assert.match(html, /function hydrateFirstVisitPanel/);
  assert.match(html, /function maybeShowFirstVisitPanel/);
  assert.match(html, /function dismissFirstVisitPanel/);
  assert.match(html, /function handleOnboardingAction/);
  assert.match(html, /hashView && hashView !== 'events'/);
  assert.match(html, /maybeShowFirstVisitPanel\(user\)/);

  assert.match(css, /\.onboarding-panel \{/);
  assert.match(css, /\.onboarding-steps \{/);
  assert.match(css, /\.onboarding-step \{/);
  assert.match(css, /\.onboarding-primary \{/);
  assert.match(css, /\.onboarding-shortcuts \{/);
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.onboarding-primary \{[\s\S]*flex-direction: column;/);
});

test('profile availability stays hidden until the owner chooses to edit it', () => {
  const html = read('public', 'profile.html');

  assert.match(html, /function toggleAvailabilityEditor/);
  assert.match(html, /id="availabilityToggle"/);
  assert.match(html, /id="availabilitySummary"/);
  assert.match(html, /id="availabilityEditor" style="display:none/);
  assert.match(html, /Hide this until you want it public/);
  assert.match(html, /Set availability/);
});
