---
phase: 09
plan: 01
title: Migration, API updates, and team join notification
wave: 1
---

# Plan: Backend marketplace signals

## Goal

Add looking_for and availability columns, update APIs for marketplace data, fire team join notifications.

## Tasks

### Task 1: Migration v015
**File:** `server.js`
**Action:** add to MIGRATIONS array

- ALTER TABLE ideas ADD COLUMN looking_for TEXT
- ALTER TABLE users ADD COLUMN skills TEXT
- ALTER TABLE users ADD COLUMN available_hours INTEGER

### Task 2: Update POST /api/ideas to accept looking_for
**File:** `server.js`
**Action:** modify

Accept optional `looking_for` from body (comma-separated string or array, store as comma-separated). Update INSERT to include looking_for column.

### Task 3: Update GET /api/ideas to return first 2 member names
**File:** `server.js`
**Action:** modify

Add a subquery or post-processing to return `member_names` field with first 2 names from idea_members joined with users. Example: "Alice, Bob" or "Alice" or null.

### Task 4: Add team join notification
**File:** `server.js`
**Action:** modify POST /api/ideas/:id/join

After successful join, call notify(idea.user_id, 'team_join', req.user.id, req.user.name, 'idea', idea.id, idea.title).

### Task 5: Add PUT /api/me/availability endpoint
**File:** `server.js`
**Action:** add

requireAuth. Accept { skills, available_hours }. Update users table. Return { ok: true }.

## Verification

- [ ] Migration v015 runs cleanly
- [ ] POST /api/ideas with looking_for stores the value
- [ ] GET /api/ideas returns member_names for each idea
- [ ] Team join fires notification to idea author
- [ ] PUT /api/me/availability saves skills and hours
