const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const buildHtml = fs.readFileSync(path.join(ROOT, "public", "build.html"), "utf8");

test("projects view exposes search, sort, quick filters, and summary UI", () => {
  assert.match(buildHtml, /id="projectSearch"/);
  assert.match(buildHtml, /id="projectSort"/);
  assert.match(buildHtml, /id="projectQuickFilters"/);
  assert.match(buildHtml, /id="projectResultsSummary"/);
  assert.match(buildHtml, /function resetProjectFilters\(\)/);
});

test("projects filtering logic supports Lunar-adjacent discovery and label filtering", () => {
  assert.match(buildHtml, /const PROJECT_LUNAR_KEYWORDS = \[/);
  assert.match(buildHtml, /function isLunarProject\(project\)/);
  assert.match(buildHtml, /function applyProjectFilters\(projects\)/);
  assert.match(buildHtml, /filterProjects\(tag\)/);
});

test("project cards render cleaner chip rows and stats for zaps and votes", () => {
  assert.match(buildHtml, /project-chip-row/);
  assert.match(buildHtml, /project-chip project-chip-category/);
  assert.match(buildHtml, /project-chip project-chip-tag/);
  assert.match(buildHtml, /project-card-stats/);
  assert.match(buildHtml, /Most zaps/);
});
