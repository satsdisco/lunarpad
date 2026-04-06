# LunarPad Source of Truth

_Last verified: 2026-04-06_

This is the canonical map for how LunarPad is hosted on the Mac mini and how we should work from the Hermes workspace without getting cute and breaking deploys.

---

## 1. The model in one sentence

**We build in the Hermes workspace, push to GitHub, staging deploys from `origin/staging` to `decks.satsdisco.com`, and production deploys from `origin/main` to `lunarpad.dev`.**

---

## 2. GitHub is the code source of truth

- **Repo:** `https://github.com/satsdisco/lunarpad`
- **Default branch:** `main`
- **Release branches that matter:**
  - `main` = production
  - `staging` = pre-prod / QA

### Workspace repo

This is the primary development repo for Luna + satsdisco:

- **Path:** `/Volumes/External/hermes-workspace/projects/lunarpad`

### Rule

**All feature work should happen in the Hermes workspace repo.**

Do not use the live deployment checkouts as your normal coding sandbox.
Those exist to run the app on the Mac mini.

---

## 3. Hosting map on the Mac mini

### Production

- **Domain:** `https://lunarpad.dev`
- **Also routed:** `https://www.lunarpad.dev`, `https://web.satsdisco.com`
- **Local code path:** `/Volumes/External/openclaw-workspace-v2/deckpad`
- **Branch expected there:** `main`
- **Port:** `3100`
- **launchd label:** `com.deckpad.server`
- **Entrypoint:** `/opt/homebrew/bin/node /Volumes/External/openclaw-workspace-v2/deckpad/server.js`
- **Logs:**
  - stdout: `/tmp/deckpad.log`
  - stderr: `/tmp/deckpad.err`

### Staging

- **Domain:** `https://decks.satsdisco.com`
- **Local code path:** `/Volumes/External/openclaw-workspace-v2/lunarpad-staging`
- **Branch expected there:** `staging`
- **Port:** `3102`
- **launchd label:** `com.lunarpad.staging`
- **Entrypoint:** `/opt/homebrew/bin/node /Volumes/External/openclaw-workspace-v2/lunarpad-staging/server.js`
- **Logs:**
  - stdout: `/tmp/lunarpad-staging-stdout.log`
  - stderr: `/tmp/lunarpad-staging-stderr.log`

### Cloudflare tunnel

- **launchd label:** `com.deckpad.tunnel`
- **Config:** `/Users/savetherobot/.cloudflared/pyramid-config.yml`
- **Routing:**
  - `lunarpad.dev` -> local `:3100`
  - `decks.satsdisco.com` -> local `:3102`

---

## 4. Operational truth

### What the deployment checkouts are for

- `/Volumes/External/openclaw-workspace-v2/lunarpad-staging` = staging runtime checkout
- `/Volumes/External/openclaw-workspace-v2/deckpad` = production runtime checkout

These are **not** the preferred place to build features.
They are the checkouts that deploy scripts reset and restart.

### What launchd owns

- production app
- staging app
- cloudflare tunnel

Do **not** leave random `node --watch` garbage running against ports `3100` or `3102`.

---

## 5. Current verified state

As of verification:

- workspace repo is synced and usable
- staging runtime is healthy on `3102`
- production runtime is healthy on `3100`
- both public URLs responded successfully
- `origin/main` and `origin/staging` were both at commit `7b42b4c` when checked

---

## 6. The workflow we want going forward

This is the foolproof mental model:

1. We build in the Hermes workspace
2. We push the code we want to test to `staging`
3. Mac mini staging deploy pulls from `origin/staging`
4. We test on `https://decks.satsdisco.com`
5. If approved, we fast-forward `main`
6. Mac mini prod deploy pulls from `origin/main`
7. The change goes live on `https://lunarpad.dev`

That means:

- **GitHub branches are the handoff between dev and hosting**
- **Mac mini deploy checkouts are consumers of GitHub state**
- **workspace is where we should think and build**

---

## 7. Workspace-first scripts

I added helper scripts in the workspace so we can drive the whole thing from the repo we actually want to work in.

### Push staging and deploy it

```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/push-staging-and-deploy.sh
```

What it does:
- verifies workspace repo is clean
- checks out `staging`
- verifies the push is fast-forward safe
- pushes `origin/staging`
- runs the Mac mini staging deploy script
- prints status

### Promote staging to main and deploy prod

```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/promote-staging-to-main-and-deploy.sh
```

Optional explicit tested ref:

```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/promote-staging-to-main-and-deploy.sh <commit-or-ref>
```

What it does:
- verifies workspace repo is clean
- fetches origin
- resolves the tested staging commit
- verifies it is a fast-forward of `origin/main`
- fast-forwards local `main`
- pushes `origin/main`
- runs the Mac mini production deploy script
- prints status

---

## 8. Practical release flow

### Build a feature

```bash
cd /Volumes/External/hermes-workspace/projects/lunarpad
git checkout main
git pull --ff-only origin main
git checkout -b feat/<name>
```

Work, commit, test locally.

### Put it on staging

When the feature is ready to test remotely:

```bash
git checkout staging
git fetch origin --prune
git merge --ff-only feat/<name>
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/push-staging-and-deploy.sh
```

Then test:

- `https://decks.satsdisco.com`

### Put it on production

When staging looks good:

```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/promote-staging-to-main-and-deploy.sh
```

Then verify:

- `https://lunarpad.dev`

---

## 9. Important caveats

### Staging auto-poller

There is an old staging poller setup in launchd history, but it has been flaky/untrustworthy.

**Do not rely on “push to staging and it will probably auto-roll out.”**
Use the explicit staging deploy flow.

### Branch protection / CI

Still missing:
- branch protection on `main`
- CI checks / smoke checks before release

So the workflow is safer now, but not yet bulletproof enough to survive maximum chaos.

### Staging env parity

Staging does not appear to mirror prod perfectly yet.
That should be tightened later so staging behaves more like the real thing.

---

## 10. The one rule to remember

**We build in Hermes workspace, GitHub branches decide what should be deployed, staging lives at `decks.satsdisco.com`, production lives at `lunarpad.dev`, and the Mac mini deploy scripts pull each environment from its matching branch.**
