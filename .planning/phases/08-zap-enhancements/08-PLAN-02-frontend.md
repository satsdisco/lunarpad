---
phase: 08
plan: 02
title: Zap UI enhancements across Foyer pages
wave: 1
---

# Plan: Frontend zap enhancements

## Goal

Add sats badge on bubbles, zap notes input, contributor list on detail, "Most Backed" filter, and top zappers in sidebar.

## Tasks

### Task 1: Sats badge on bubbles
**File:** `public/foyer.html`
**Action:** modify

In renderBubbles, add a sats badge similar to views_today badge. Show total_sats_received when > 0: "⚡ 500".

### Task 2: Rename "Most Zapped" filter to "Most Backed"
**File:** `public/foyer.html`
**Action:** modify

Change filter button label from "Most Zapped" to "Most Backed". Keep sort param as most_zapped (API already handles it).

### Task 3: Add note field to zap flow on detail page
**File:** `public/foyer-detail.html`
**Action:** modify

In the zapPanel, add a text input for optional note between amount and submit button. Pass note in POST body.

### Task 4: Add zap contributors section on detail page
**File:** `public/foyer-detail.html`
**Action:** modify

After the zap panel, add a "Backed by" section. Fetch GET /api/ideas/:id/zaps and render: name, amount, note (if any), timestamp.

### Task 5: Top Zappers in sidebar
**File:** `public/foyer.html`
**Action:** modify

Add a "Top Zappers" section above the activity feed in the sidebar. Fetch GET /api/foyer/top-zappers, render ranked list with name and total sats.

### Task 6: CSS for new elements
**File:** `public/css/style.css`
**Action:** add

Styles for: .bubble-sats badge, .zap-contributors section, .top-zappers section, .zap-note display.

## Verification

- [ ] Bubbles show sats badge when > 0
- [ ] "Most Backed" filter works
- [ ] Zap flow has note input field
- [ ] Detail page shows "Backed by" list with zapper names, amounts, notes
- [ ] Sidebar shows "Top Zappers This Week"
