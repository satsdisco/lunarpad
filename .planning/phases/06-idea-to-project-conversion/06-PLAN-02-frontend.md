---
phase: 06
plan: 02
title: Conversion UI and bidirectional links
wave: 1
---

# Plan: Conversion UI and bidirectional links

## Goal

Add convert button and modal on idea detail, converted badge on bubbles, and back-link on project detail.

## Tasks

### Task 1: Convert button and modal on foyer-detail.html
**File:** `public/foyer-detail.html`
**Action:** modify

In renderIdea():
- If idea.converted_to_project_id: show "Converted to project: [name]" link instead of convert button
- If user is author or admin and not converted: show "Convert to Project" button
- Button opens a confirmation modal with pre-filled project name (editable), shows what carries over (sats, team count)
- Submit calls POST /api/ideas/:id/convert with { name }
- On success, redirect to /project/:id

### Task 2: Converted badge on bubbles
**File:** `public/foyer.html`
**Action:** modify

In renderBubbles(): if idea.converted_to_project_id is set, add a small checkmark badge or "Converted" label on the bubble.

### Task 3: Back-link on project detail
**File:** `public/project.html`
**Action:** modify

After loading project data, if project.source_idea_id exists, show "Born from idea: [title]" link above the description. Fetch idea title via GET /api/ideas/:id or include it in the project API response.

### Task 4: Include source_idea_id in project API
**File:** `server.js`
**Action:** verify

GET /api/projects/:id already uses SELECT * which includes source_idea_id after migration. May need to join ideas table to get idea title for display.

## Verification

- [ ] Convert button visible to author/admin on unconverted idea
- [ ] Convert button hidden on converted idea, shows project link instead
- [ ] Conversion modal shows pre-filled name, sats, team count
- [ ] After conversion, redirects to new project page
- [ ] Converted bubbles show visual badge in The Foyer
- [ ] Project page shows "Born from idea" back-link
