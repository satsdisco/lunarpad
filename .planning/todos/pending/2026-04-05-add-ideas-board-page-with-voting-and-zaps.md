---
created: 2026-04-05T14:39:54.002Z
title: Add ideas board page with voting and zaps
area: ui
files:
  - server.js
  - public/build.html
  - public/css/style.css
---

## Problem

No way for users to suggest what gets built next. Ideas live in Slack or conversations and get lost. Need an open, community-driven space where anyone can propose project ideas, and the community can signal what matters most through upvotes and zaps.

## Solution

New "Ideas" page accessible from the top navigation bar. Core features:

- Anyone can post an idea (title, description, optional tags/category)
- Ideas are listed with upvote counts and zap totals
- Reuse existing vote and zap infrastructure (POST /api/vote, zap flow)
- Sorting/filtering like the comment system (top, newest, most zapped)
- Ideas table in SQLite: id, title, description, user_id, tags, created_at, total_sats_received
- Threaded comments on ideas (reuse comment system with parent_id)
- Link to the ideas page from the main nav bar alongside Build in Public, Decks, etc.
