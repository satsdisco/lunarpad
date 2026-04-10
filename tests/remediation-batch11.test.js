const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('build page onboarding stays focused on the two real setup tasks', () => {
  const html = read('public', 'build.html');
  const css = read('public', 'css', 'style.css');

  assert.match(html, /id="firstVisitPanel"/);
  assert.match(html, /Welcome to LunarPad/);
  assert.match(html, /id="onboardingNameSuffix"/);
  assert.match(html, /0 \/ 2 complete/);
  assert.match(html, /Set up your profile/);
  assert.match(html, /Add your first project/);
  assert.match(html, /Open profile/);
  assert.match(html, /Add project/);
  assert.doesNotMatch(html, />Next</);
  assert.match(html, /Events/);
  assert.match(html, /Bounties/);
  assert.match(html, /The Foyer/);
  assert.match(html, /Skip/);
  assert.match(html, /const FIRST_VISIT_PANEL_KEY = 'lunarpad:first-visit-panel:dismissed:v2'/);
  assert.match(html, /const ONBOARDING_PROGRESS_KEY = 'lunarpad:onboarding-progress:v1'/);
  assert.match(html, /function shouldForceShowFirstVisitPanel/);
  assert.match(html, /function readOnboardingProgress/);
  assert.match(html, /function getOnboardingChecklistState/);
  assert.match(html, /function renderOnboardingChecklist/);
  assert.match(html, /function handleOnboardingAction/);
  assert.match(html, /profileStatus\.hidden = !state\.profileReady/);
  assert.match(html, /projectStatus\.hidden = !state\.hasProject/);
  assert.match(html, /const profileReady = !!\(user && \(user\.bio \|\| user\.website_url \|\| user\.github_url \|\| user\.lightning_address\)\);/);
  assert.doesNotMatch(html, /Add a bio, links, lightning, or availability/);
  assert.match(html, /Add a bio, links, or lightning so people know who you are\./);
  assert.match(html, /viewName === 'project'/);
  assert.doesNotMatch(html, /Explore the live flow/);
  assert.doesNotMatch(html, /Browse build flow/);
  assert.doesNotMatch(html, /function handleOnboardingAction\([\s\S]*dismissFirstVisitPanel\(\)/);

  assert.match(css, /\.onboarding-progress \{/);
  assert.match(css, /\.onboarding-steps \{/);
  assert.match(css, /\.onboarding-step-actions \{/);
  assert.match(css, /\.onboarding-task-btn \{/);
  assert.match(css, /\.onboarding-shortcuts \{/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.onboarding-progress \{/);
});

test('profile availability stays hidden until the owner chooses to edit it', () => {
  const html = read('public', 'profile.html');

  assert.match(html, /function toggleAvailabilityEditor/);
  assert.match(html, /function replayBuildOnboarding/);
  assert.match(html, /id="availabilityToggle"/);
  assert.match(html, /id="availabilitySummary"/);
  assert.match(html, /id="availabilityEditor" style="display:none/);
  assert.match(html, /Hide this until you want it public/);
  assert.match(html, /Set availability/);
  assert.match(html, /Replay onboarding/);
});
