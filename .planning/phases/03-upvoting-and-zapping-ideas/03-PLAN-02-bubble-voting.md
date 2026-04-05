---
phase: 03
plan: 02
title: Bubble Voting
wave: 1
---

# Plan 02: Bubble Voting

## Objective

Add a hover upvote arrow to idea bubbles in `foyer.html`. Clicking the arrow votes without navigating. Clicking the bubble elsewhere navigates to the detail page.

## File

`public/foyer.html`

---

## Task 1: Load voted state before rendering

After `loadIdeas` fetches the ideas array and before calling `renderBubbles`, fetch the user's existing votes for all loaded idea IDs. Store the voted set in a module-scoped variable.

Add `let _votedIds = new Set();` alongside the existing `let _ideas = [];` declaration.

In `loadIdeas`, after setting `_ideas`, add:

```js
    if (_ideas.length) {
      try {
        const ids = _ideas.map(i => i.id).join(',');
        const vRes = await fetch('/api/vote/check?type=idea&ids=' + ids);
        if (vRes.ok) {
          const vData = await vRes.json();
          _votedIds = new Set(Object.keys(vData).filter(k => vData[k]));
        }
      } catch { /* non-fatal */ }
    }
```

## Task 2: Update renderBubbles to include vote arrow

The current bubble template is an `<a>` tag containing `.bubble-title` and `.bubble-votes`. Wrap the vote row in a button that stops propagation and calls `voteOnBubble`.

Replace the `return` inside the `.map()` call:

Current:
```js
    return `<a href="/foyer/${esc(idea.id)}" class="idea-bubble" style="width:${size}px;height:${size}px">
      <span class="bubble-title" style="font-size:${fontSize}rem">${esc(idea.title)}</span>
      <span class="bubble-votes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>${votes}</span>
    </a>`;
```

Replace with:
```js
    const voted = _votedIds.has(idea.id);
    return `<a href="/foyer/${esc(idea.id)}" class="idea-bubble${voted ? ' voted' : ''}" style="width:${size}px;height:${size}px" data-id="${esc(idea.id)}" data-votes="${votes}">
      <span class="bubble-title" style="font-size:${fontSize}rem">${esc(idea.title)}</span>
      <button class="bubble-vote-btn${voted ? ' active' : ''}" onclick="voteOnBubble(event, '${esc(idea.id)}')" title="Upvote" aria-label="Upvote">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        <span class="bubble-vote-count">${votes}</span>
      </button>
    </a>`;
```

## Task 3: Add voteOnBubble function

Add after the `sortIdeas` function:

```js
async function voteOnBubble(e, ideaId) {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.currentTarget;
  const bubble = btn.closest('.idea-bubble');
  const countEl = btn.querySelector('.bubble-vote-count');
  let current = parseInt(countEl.textContent) || 0;
  try {
    const res = await fetch('/api/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'idea', id: ideaId })
    });
    if (!res.ok) return;
    const data = await res.json();
    countEl.textContent = data.votes;
    btn.classList.toggle('active', data.voted);
    bubble.classList.toggle('voted', data.voted);
    if (data.voted) {
      bubble.classList.add('zap-glow');
      setTimeout(() => bubble.classList.remove('zap-glow'), 600);
      _votedIds.add(ideaId);
    } else {
      _votedIds.delete(ideaId);
    }
    // Keep local array in sync
    const idea = _ideas.find(i => i.id === ideaId);
    if (idea) idea.votes = data.votes;
  } catch { /* non-fatal */ }
}
```

## Task 4: Add CSS for bubble vote button

Add to `public/css/style.css` (append to the foyer section, or inline in a `<style>` block in foyer.html as a fallback).

Add a `<style>` block inside foyer.html's `<head>` immediately after the stylesheet link:

```html
<style>
.bubble-vote-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text2);
  font-size: 0.7rem;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity .15s, color .15s, background .15s;
  pointer-events: none;
}
.bubble-vote-btn svg { width: 12px; height: 12px; }
.idea-bubble:hover .bubble-vote-btn {
  opacity: 1;
  pointer-events: auto;
}
.bubble-vote-btn.active,
.bubble-vote-btn:hover {
  color: var(--accent);
  background: rgba(124,92,252,.12);
}
.idea-bubble.zap-glow {
  box-shadow: 0 0 18px 4px rgba(124,92,252,.45);
  transition: box-shadow .1s;
}
</style>
```

---

## Verification

- Hovering a bubble shows the upvote arrow; moving away hides it
- Clicking the arrow calls `POST /api/vote` and updates the count in place, no navigation
- Clicking the bubble title navigates to `/foyer/:id`
- Arrow shows active (purple) state when user has already voted
- Brief glow animation fires on vote
- Voting again toggles (removes vote, count decrements, arrow returns to inactive state)
