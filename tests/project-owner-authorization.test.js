const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('project management UI only exposes owner controls to the project owner or admins', () => {
  const projectHtml = read('public', 'project.html');
  assert.match(projectHtml, /const canManageProject = me\.user\.is_admin \|\| \(currentProject\.user_id && currentProject\.user_id === me\.user\.id\);/);
  assert.doesNotMatch(projectHtml, /currentProject\.user_id === me\.user\.id \|\| !currentProject\.user_id/);
});

test('project mutation routes require an actual owner or admin before banner and related project changes', () => {
  const server = read('server.js');
  assert.match(server, /function canManageProject\(project, user\) \{/);
  assert.match(server, /return !!project\.user_id && user\.id === project\.user_id;/);
  assert.match(server, /app\.post\('\/api\/projects\/:id\/banner',[\s\S]*if \(!canManageProject\(project, req\.user\)\) \{/);
  assert.match(server, /app\.put\('\/api\/projects\/:id',[\s\S]*if \(!canManageProject\(project, req\.user\)\) return res\.status\(403\)\.json\(\{ error: 'Not your project' \}\);/);
  assert.match(server, /app\.delete\('\/api\/projects\/:id',[\s\S]*if \(!canManageProject\(p, req\.user\)\) return res\.status\(403\)\.json\(\{ error: 'Not authorized' \}\);/);
});
