---
phase: 03
plan: 01
title: Idea Zap Endpoint
wave: 1
---

# Plan 01: Idea Zap Endpoint

## Objective

Add `POST /api/ideas/:id/zap` and `GET /api/ideas/:id/zaps` endpoints in `server.js`, and patch the verify endpoint to handle `target_type = 'idea'` correctly.

## File

`server.js`

---

## Task 1: Add POST /api/ideas/:id/zap

Insert after `DELETE /api/ideas/:id` (line ~2159), before the Project Deck Versions section comment.

Follow the exact pattern from `POST /api/projects/:id/zap` (line 1586). Differences: lookup from `ideas` table, `target_type = 'idea'`, memo uses `idea.title`, recipient resolved from `idea.user_id`.

```js
// POST /api/ideas/:id/zap — generate invoice to zap this idea's author
app.post('/api/ideas/:id/zap', requireAuth, async (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'Idea not found' });
  const amount_sats = parseInt(req.body.amount_sats);
  if (!amount_sats || amount_sats < 1) return res.status(400).json({ error: 'amount_sats required' });
  if (amount_sats > 10_000_000) return res.status(400).json({ error: 'amount_sats exceeds maximum (10M sats)' });

  let recipientAddress = null;
  let recipient = 'Unknown';

  if (idea.user_id) {
    const author = db.prepare('SELECT name, lightning_address FROM users WHERE id = ?').get(idea.user_id);
    if (author?.lightning_address) {
      recipientAddress = author.lightning_address;
      recipient = author.name || recipient;
    }
  }

  try {
    const webhookUrl = (process.env.BASE_URL || `http://localhost:${PORT}`) + '/api/webhook/lnbits';
    const lnbitsInv = await lnbitsCreateInvoice(amount_sats, `Zap: ${idea.title}`, webhookUrl);
    const zapId = crypto.randomUUID();
    db.prepare(`INSERT INTO zaps (id, target_type, target_id, user_id, user_name, amount_sats, payment_request, payment_hash, verify_url, status, recipient_address)
      VALUES (?, 'idea', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`).run(
      zapId, idea.id,
      req.user.id, req.user.name || req.user.email,
      amount_sats, lnbitsInv.payment_request, lnbitsInv.payment_hash, recipientAddress
    );
    const qrData = 'lightning:' + lnbitsInv.payment_request.toUpperCase();
    const qr_data_url = await makeQrDataUrl(qrData);
    res.json({ zap_id: zapId, payment_request: lnbitsInv.payment_request, qr_data_url, recipient });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

## Task 2: Add GET /api/ideas/:id/zaps

Insert immediately after the POST above.

```js
// GET /api/ideas/:id/zaps — confirmed zaps for this idea
app.get('/api/ideas/:id/zaps', (req, res) => {
  const zaps = db.prepare(
    `SELECT id, user_id, user_name, amount_sats, created_at
     FROM zaps WHERE target_type = 'idea' AND target_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC LIMIT 20`
  ).all(req.params.id);
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE target_type = 'idea' AND target_id = ? AND status = 'confirmed'`
  ).get(req.params.id);
  res.json({ zaps, total_sats: row?.total || 0 });
});
```

## Task 3: Patch GET /api/zaps/verify/:zap_id to handle 'idea'

The current verify endpoint (line ~1718) uses an if/else with `deck` vs everything-else. The else branch incorrectly updates the `projects` table for any non-deck target_type, including `idea`.

Locate the confirmation block starting at `if (paid) {` inside `GET /api/zaps/verify/:zap_id`. Change the else branch from:

```js
      } else {
        db.prepare(`UPDATE projects SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const project = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(zap.target_id);
        if (project?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, project.user_id);
          notify(project.user_id, 'zap', zap.user_id, zapperName, 'project', zap.target_id, project.name);
        }
      }
```

To an explicit if/else if/else chain:

```js
      } else if (zap.target_type === 'project') {
        db.prepare(`UPDATE projects SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const project = db.prepare('SELECT user_id, name FROM projects WHERE id = ?').get(zap.target_id);
        if (project?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, project.user_id);
          notify(project.user_id, 'zap', zap.user_id, zapperName, 'project', zap.target_id, project.name);
        }
      } else if (zap.target_type === 'idea') {
        db.prepare(`UPDATE ideas SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, zap.target_id);
        const idea = db.prepare('SELECT user_id, title FROM ideas WHERE id = ?').get(zap.target_id);
        if (idea?.user_id) {
          db.prepare(`UPDATE users SET total_sats_received = total_sats_received + ? WHERE id = ?`).run(zap.amount_sats, idea.user_id);
          notify(idea.user_id, 'zap', zap.user_id, zapperName, 'idea', zap.target_id, idea.title);
        }
      }
```

Apply the same fix to `POST /api/zaps/confirm/:zap_id` (line ~1765) which has the identical else-only pattern.

---

## Verification

- `POST /api/ideas/:id/zap` with valid `amount_sats` returns `{ zap_id, payment_request, qr_data_url, recipient }`
- `GET /api/ideas/:id/zaps` returns `{ zaps: [...], total_sats: N }`
- After simulating payment confirmation via `GET /api/zaps/verify/:zap_id`, the idea's `total_sats_received` increments and the project table is not touched
- Author receives a zap notification
