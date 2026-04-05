---
phase: 08
plan: 01
title: Zap notes migration, endpoint update, and top zappers API
wave: 1
---

# Plan: Backend zap enhancements

## Goal

Add note column to zaps, accept notes in zap endpoint, and add top-zappers API.

## Tasks

### Task 1: Migration v014
**File:** `server.js`
**Action:** add to MIGRATIONS array

ALTER TABLE zaps ADD COLUMN note TEXT

### Task 2: Update POST /api/ideas/:id/zap
**File:** `server.js`
**Action:** modify

Accept optional `note` from req.body. Include in INSERT statement.

### Task 3: Update GET /api/ideas/:id/zaps
**File:** `server.js`
**Action:** modify

Include `note` in the SELECT (already selected via columns, but verify it's returned).

### Task 4: Add GET /api/foyer/top-zappers
**File:** `server.js`
**Action:** add after GET /api/foyer/activity

Query: SELECT user_id, user_name, SUM(amount_sats) as total_sats FROM zaps WHERE target_type = 'idea' AND status = 'confirmed' AND confirmed_at >= date('now', '-7 days') GROUP BY user_id ORDER BY total_sats DESC LIMIT 5. Join users for avatar.

## Verification

- [ ] POST /api/ideas/:id/zap with note field stores it
- [ ] GET /api/ideas/:id/zaps returns note field
- [ ] GET /api/foyer/top-zappers returns ranked list
