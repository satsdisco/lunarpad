# Requirements: LunarPad — The Foyer

**Defined:** 2026-04-05
**Core Value:** Give Bitcoin builders a living home to share work, compete, and earn sats

## v1 Requirements

Requirements for The Foyer feature. Each maps to roadmap phases.

### Ideas

- [ ] **IDEA-01**: User can post an idea with title and description
- [ ] **IDEA-02**: User can view a list of all ideas on The Foyer page
- [ ] **IDEA-03**: User can upvote ideas (reuse existing vote system)
- [ ] **IDEA-04**: User can zap ideas with sats (sats pool for the team, not the author)
- [ ] **IDEA-05**: User can sort/filter ideas by top voted, most zapped, newest, biggest teams

### Teams

- [ ] **TEAM-01**: User can join an idea's team via a Join button
- [ ] **TEAM-02**: User can leave a team they previously joined
- [ ] **TEAM-03**: Idea page shows list of team members

### Comments

- [ ] **CMNT-01**: User can post threaded comments on ideas (reuse existing comment system)
- [ ] **CMNT-02**: Thread-scoped notifications fire on idea comments/replies

### Conversion

- [ ] **CONV-01**: Idea author or admin can convert an idea to a project
- [ ] **CONV-02**: Conversion carries over sats pool as project bounty
- [ ] **CONV-03**: Conversion carries over team members as project contributors
- [ ] **CONV-04**: Converted idea links back to the origin project and vice versa

### Navigation

- [ ] **NAV-01**: "The Foyer" tab appears in the top navigation bar alongside existing tabs

## v2 Requirements

Active scope for v2.0 milestone (The Living Foyer).

### Activity and Ambient Signals

- [ ] **LIVE-01**: Activity ticker showing recent Foyer actions in real time
- [ ] **LIVE-02**: "Viewed by X people today" counter on idea bubbles
- [ ] **LIVE-03**: Recent activity section (last 10 actions) on The Foyer page
- [ ] **LIVE-04**: "Builder online" indicator on idea detail when author is on platform

### Zap Enhancements

- [ ] **ZAP-01**: Optional "note" field on zaps (message attached to payment)
- [ ] **ZAP-02**: Contributor visibility on idea cards (who zapped, not just total)
- [ ] **ZAP-03**: "Most Backed" sort option ranking by total sats received
- [ ] **ZAP-04**: Weekly "Top Zappers" callout on The Foyer

### Marketplace Signals

- [ ] **MKT-01**: "Looking for" tags on ideas (e.g. "Need: designer")
- [ ] **MKT-02**: Builder availability profiles (skills, hours/week)
- [ ] **MKT-03**: Named team members on bubbles ("Alice, Bob +2")
- [ ] **MKT-04**: Notification when someone joins your idea's team

### Event Integration

- [ ] **EVT-01**: Demo day countdown banner on The Foyer
- [ ] **EVT-02**: "Pitch at Demo Day" CTA on idea cards when event upcoming
- [ ] **EVT-03**: Auto-selected "Idea of the Week" spotlight
- [ ] **EVT-04**: Weekly themed periods with visual indicator and digest notification

### Deferred to v3+

- **TEAM-04**: Team members can have roles (builder, designer, researcher)
- **TEAM-05**: Idea author can approve/reject join requests
- **DISC-01**: Search across idea titles and descriptions

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Streak mechanics | Not enough daily content at small scale; breaks cause churn |
| Real-time viewer counts | Shows 0 too often, anti-social proof |
| Points for posting/commenting | Kills signal-to-noise immediately |
| Follower counts on profiles | Resist status-signaling (HN principle) |
| Algorithmic matching | Too few people; visible signals work better |
| Role-based teams | Overhead without value at this scale |
| Nostr identity integration | Experimental, high effort, defer until more users |
| Private/draft ideas | Everything is public immediately |
| Email/push notifications | In-app only for now |
| Idea editing after conversion | Once converted, the project is the source of truth |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| IDEA-01 | Phase 1 (API), Phase 2 (UI) | Complete |
| IDEA-02 | Phase 1 (API), Phase 2 (UI) | Complete |
| IDEA-03 | Phase 3 | Complete |
| IDEA-04 | Phase 3 | Complete |
| IDEA-05 | Phase 1 (API), Phase 2 (UI) | Complete |
| TEAM-01 | Phase 4 | Complete |
| TEAM-02 | Phase 4 | Complete |
| TEAM-03 | Phase 4 | Complete |
| NAV-01 | Phase 2 | Complete |
| CMNT-01 | Phase 5 | Pending |
| CMNT-02 | Phase 5 | Pending |
| CONV-01 | Phase 6 | Pending |
| CONV-02 | Phase 6 | Pending |
| CONV-03 | Phase 6 | Pending |
| CONV-04 | Phase 6 | Pending |
| LIVE-01 | Phase 7 | Pending |
| LIVE-02 | Phase 7 | Pending |
| LIVE-03 | Phase 7 | Pending |
| LIVE-04 | Phase 7 | Pending |
| ZAP-01 | Phase 8 | Pending |
| ZAP-02 | Phase 8 | Pending |
| ZAP-03 | Phase 8 | Pending |
| ZAP-04 | Phase 8 | Pending |
| MKT-01 | Phase 9 | Pending |
| MKT-02 | Phase 9 | Pending |
| MKT-03 | Phase 9 | Pending |
| MKT-04 | Phase 9 | Pending |
| EVT-01 | Phase 10 | Pending |
| EVT-02 | Phase 10 | Pending |
| EVT-03 | Phase 10 | Pending |
| EVT-04 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 15 total (9 complete, 6 pending)
- v2 requirements: 16 total (0 complete)
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after v2 engagement research*
