---
phase: 09
plan: 02
title: Marketplace UI across Foyer and profile pages
wave: 1
---

# Plan: Frontend marketplace signals

## Goal

Add role chips to post idea modal, looking-for badges on detail page, named teams on bubbles, availability section on profile.

## Tasks

### Task 1: Role chip picker in Post Idea modal
**File:** `public/foyer.html`
**Action:** modify

Add a multi-select chip picker in the ideaModal form. Preset roles: Designer, Frontend Dev, Backend Dev, Lightning Dev, Marketing, Tester. Click to toggle active. Store selected as comma-separated in a hidden input. Pass looking_for in POST body.

### Task 2: Named team on bubbles
**File:** `public/foyer.html`
**Action:** modify

In renderBubbles, if idea.member_names exists, show it on the bubble: "Alice, Bob +N" (where N = team_size - 2). Small text below the title.

### Task 3: Looking-for indicator on bubbles
**File:** `public/foyer.html`
**Action:** modify

If idea.looking_for is set, show a small 👥 icon badge on the bubble (same positioning pattern as views/sats badges).

### Task 4: Looking-for badges on detail page
**File:** `public/foyer-detail.html`
**Action:** modify

In renderIdea, after the description, show looking_for as styled chip badges: "Looking for: Designer, Lightning Dev".

### Task 5: Availability section on profile page
**File:** `public/profile.html`
**Action:** modify

Add an "Availability" card with: skills multi-select chips (same preset list), hours/week number input, save button calling PUT /api/me/availability. Show current values when viewing own profile.

### Task 6: CSS for chips and badges
**File:** `public/css/style.css`
**Action:** add

Styles for: .role-chip (toggle chip), .role-chip.active, .looking-for-badge, .bubble-team-names, .availability-card.

## Verification

- [ ] Post Idea modal shows role chips, submits looking_for
- [ ] Bubbles show named team members
- [ ] Bubbles show 👥 indicator when looking_for is set
- [ ] Detail page shows looking-for badges
- [ ] Profile page has working availability section
