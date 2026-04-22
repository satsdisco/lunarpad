const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

test('mobile onboarding and shared chrome are tightened for smaller screens', () => {
  const css = read('public', 'css', 'style.css')

  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.onboarding-progress-copy \{[\s\S]*display: none;/)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.onboarding-step-copy span \{[\s\S]*display: none;/)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.footer-links a \{[\s\S]*border-radius: 999px;/)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.header-actions \.notif-bell \{[\s\S]*width: 36px;/)
})

test('decks mobile filter hint is more explicit and card metadata can wrap cleanly', () => {
  const css = read('public', 'css', 'style.css')
  const html = read('public', 'index.html')

  assert.match(html, /Swipe to browse more deck filters →/)
  assert.match(css, /\.decks-tag-overflow-hint::before \{[\s\S]*content: '↔';/)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.card-meta-primary,[\s\S]*justify-content: flex-start;[\s\S]*flex-wrap: wrap;/)
})

test('foyer empty activity state has supportive copy and mobile spacing is tightened', () => {
  const css = read('public', 'css', 'style.css')
  const html = read('public', 'foyer.html')

  assert.match(html, /foyer-activity-empty/)
  assert.match(html, /Once someone posts an idea or joins a thread, the latest foyer movement will show up here\./)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.foyer-empty-card \{[\s\S]*padding: 20px 14px;/)
  assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.foyer-activity-empty \{[\s\S]*display: grid;/)
})
