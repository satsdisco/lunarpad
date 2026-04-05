---
phase: 06
plan: 01
title: Migration v012 and conversion endpoint
wave: 1
---

# Plan: Migration v012 and conversion endpoint

## Goal

Add database columns for bidirectional idea-project linking and the POST /api/ideas/:id/convert endpoint.

## Tasks

### Task 1: Migration v012
**File:** `server.js`
**Action:** add to MIGRATIONS array

Add after v011_ideas:
- ALTER TABLE ideas ADD COLUMN converted_to_project_id TEXT
- ALTER TABLE projects ADD COLUMN source_idea_id TEXT

### Task 2: POST /api/ideas/:id/convert endpoint
**File:** `server.js`
**Action:** add after idea comment endpoints

- requireAuth, check author or admin
- Check idea not already converted (converted_to_project_id is null)
- Accept optional { name } override from body, default to idea.title
- Create project: id, name, builder (author name), description (idea.description), user_id, slug, total_sats_received (from idea), source_idea_id
- Copy idea_members to bounty_participants or just note them (projects don't have a members table, but the project's user_id is set)
- Update idea: set converted_to_project_id
- Return { project_id, project_slug }

### Task 3: Update GET /api/ideas/:id
**File:** `server.js`
**Action:** modify

The existing query uses `SELECT i.*` which already includes converted_to_project_id after migration. No change needed to the query, but verify the field is returned.

## Verification

- [ ] Migration v012 runs cleanly
- [ ] POST /api/ideas/:id/convert creates a project and sets bidirectional IDs
- [ ] POST /api/ideas/:id/convert on already-converted idea returns 409
- [ ] POST by non-author non-admin returns 403
- [ ] GET /api/ideas/:id returns converted_to_project_id field
