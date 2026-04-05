---
phase: 03
plan: 03
title: Detail Page Vote and Zap
wave: 1
---

# Plan 03: Detail Page Vote and Zap

## Objective

Wire the Upvote and Zap buttons on `foyer-detail.html`. Upvote toggles via existing vote API. Zap opens an inline amount input, generates an LNbits invoice, shows a QR code, and polls for confirmation.

## File

`public/foyer-detail.html`

---

## Task 1: Replace disabled buttons with functional markup

In `renderIdea`, the current actions block is:

```js
      <div class="foyer-detail-actions">
        <button class="btn btn-sm" disabled title="Coming soon">Upvote</button>
        <button class="btn btn-sm" disabled title="Coming soon">Zap</button>
        <button class="btn btn-sm" disabled title="Coming soon">Join Team</button>
      </div>
```

Replace with:

```js
      <div class="foyer-detail-actions">
        <button class="btn btn-sm vote-btn" id="voteBtn" onclick="toggleVote()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;vertical-align:-1px"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          Upvote <span id="voteCount">${idea.votes || 0}</span>
        </button>
        <button class="btn btn-sm" id="zapBtn" onclick="openZap()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;vertical-align:-1px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          Zap
        </button>
        <button class="btn btn-sm" disabled title="Coming soon">Join Team</button>
      </div>
      <div id="zapPanel" style="display:none;margin-top:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="number" id="zapAmount" placeholder="Amount in sats" min="1" max="10000000"
            style="width:160px;padding:6px 10px;background:var(--glass);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.85rem">
          <button class="btn btn-sm btn-primary" onclick="submitZap()">Generate Invoice</button>
          <button class="btn btn-sm" onclick="closeZap()">Cancel</button>
        </div>
        <div id="zapQr" style="margin-top:12px;display:none">
          <img id="zapQrImg" src="" alt="Lightning QR" style="width:180px;height:180px;border-radius:8px;display:block;margin-bottom:8px">
          <p id="zapStatus" style="font-size:0.8rem;color:var(--muted)">Waiting for payment...</p>
          <p style="font-size:0.7rem;color:var(--muted);word-break:break-all" id="zapInvoiceText"></p>
        </div>
      </div>
```

## Task 2: Add vote state variables and initialise on load

Add module-scoped state variables at the top of the `<script>` block, after `const ideaId = ...`:

```js
let _voted = false;
let _zapPollTimer = null;
let _currentZapId = null;
```

In `loadIdea`, after the `document.getElementById('ideaContent').innerHTML = renderIdea(idea)` line, add:

```js
    initVoteState();
```

## Task 3: Add initVoteState function

```js
async function initVoteState() {
  try {
    const res = await fetch('/api/vote/check?type=idea&ids=' + ideaId);
    if (!res.ok) return;
    const data = await res.json();
    _voted = !!data[ideaId];
    const btn = document.getElementById('voteBtn');
    if (!btn) return;
    btn.classList.toggle('active', _voted);
    if (_voted) btn.style.color = 'var(--accent)';
  } catch { /* non-fatal */ }
}
```

## Task 4: Add toggleVote function

```js
async function toggleVote() {
  const btn = document.getElementById('voteBtn');
  const countEl = document.getElementById('voteCount');
  if (!btn || !countEl) return;
  try {
    const res = await fetch('/api/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'idea', id: ideaId })
    });
    if (!res.ok) return;
    const data = await res.json();
    _voted = data.voted;
    countEl.textContent = data.votes;
    btn.classList.toggle('active', _voted);
    btn.style.color = _voted ? 'var(--accent)' : '';
  } catch { /* non-fatal */ }
}
```

## Task 5: Add zap flow functions

```js
function openZap() {
  document.getElementById('zapPanel').style.display = '';
  document.getElementById('zapQr').style.display = 'none';
  document.getElementById('zapAmount').focus();
}

function closeZap() {
  document.getElementById('zapPanel').style.display = 'none';
  if (_zapPollTimer) { clearInterval(_zapPollTimer); _zapPollTimer = null; }
  _currentZapId = null;
}

async function submitZap() {
  const amount = parseInt(document.getElementById('zapAmount').value);
  if (!amount || amount < 1) return alert('Enter an amount in sats');
  const btn = document.querySelector('#zapPanel .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/ideas/' + ideaId + '/zap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_sats: amount })
    });
    if (!res.ok) {
      const e = await res.json();
      alert(e.error || 'Failed to create invoice');
      btn.disabled = false;
      btn.textContent = 'Generate Invoice';
      return;
    }
    const data = await res.json();
    _currentZapId = data.zap_id;
    document.getElementById('zapQrImg').src = data.qr_data_url;
    document.getElementById('zapInvoiceText').textContent = data.payment_request;
    document.getElementById('zapQr').style.display = '';
    document.getElementById('zapStatus').textContent = 'Waiting for payment...';
    btn.disabled = false;
    btn.textContent = 'Generate Invoice';
    startZapPoll();
  } catch {
    alert('Failed to create invoice');
    btn.disabled = false;
    btn.textContent = 'Generate Invoice';
  }
}

function startZapPoll() {
  if (_zapPollTimer) clearInterval(_zapPollTimer);
  _zapPollTimer = setInterval(async () => {
    if (!_currentZapId) return;
    try {
      const res = await fetch('/api/zaps/verify/' + _currentZapId);
      if (!res.ok) return;
      const data = await res.json();
      if (data.settled) {
        clearInterval(_zapPollTimer);
        _zapPollTimer = null;
        document.getElementById('zapStatus').textContent = 'Payment confirmed! Thank you.';
        document.getElementById('zapQrImg').style.opacity = '0.3';
        // Update sats display
        const satsEl = document.querySelector('.foyer-detail-stats .stat-value:nth-child(1)');
        // Safer: re-fetch idea stats
        try {
          const iRes = await fetch('/api/ideas/' + ideaId);
          if (iRes.ok) {
            const idea = await iRes.json();
            // Update all stat values in the stats row
            const stats = document.querySelectorAll('.foyer-detail-stats .stat-value');
            if (stats[1]) stats[1].textContent = idea.total_sats_received || 0;
          }
        } catch { /* non-fatal */ }
        setTimeout(closeZap, 3000);
      }
    } catch { /* non-fatal */ }
  }, 3000);
}
```

---

## Verification

- On page load, Upvote button reflects current voted state (highlighted if already voted)
- Clicking Upvote toggles vote, count updates immediately
- Clicking Zap shows amount input panel
- Submitting a valid amount generates an invoice and renders QR code
- Poll fires every 3s; on confirmation: status updates, sats total refreshes, panel closes after 3s
- Cancel button closes panel and stops polling
- All buttons remain enabled (not disabled) after initial load
