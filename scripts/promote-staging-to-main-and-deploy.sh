#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_REPO="/Volumes/External/hermes-workspace/projects/lunarpad"
PROD_URL="https://lunarpad.dev"
DEPLOY_PROD_SCRIPT="/Volumes/External/openclaw-workspace-v2/scripts/lunarpad-deploy-prod.sh"
STATUS_SCRIPT="/Volumes/External/openclaw-workspace-v2/scripts/lunarpad-status.sh"
SOURCE_REF="${1:-origin/staging}"

cd "$WORKSPACE_REPO"

echo "==> Workspace repo: $WORKSPACE_REPO"
echo "==> Fetching origin"
git fetch origin --prune

echo "==> Verifying clean workspace checkout"
if [[ -n "$(git status --short)" ]]; then
  echo "ERROR: workspace repo has uncommitted changes" >&2
  git status --short >&2
  exit 1
fi

SOURCE_SHA="$(git rev-parse "$SOURCE_REF")"
MAIN_REMOTE_SHA="$(git rev-parse origin/main)"
STAGING_REMOTE_SHA="$(git rev-parse origin/staging)"

echo "==> Source ref:         $SOURCE_REF"
echo "==> Source SHA:         $SOURCE_SHA"
echo "==> origin/staging SHA: $STAGING_REMOTE_SHA"
echo "==> origin/main SHA:    $MAIN_REMOTE_SHA"

if [[ "$SOURCE_SHA" != "$STAGING_REMOTE_SHA" ]]; then
  echo "WARNING: source ref is not current origin/staging." >&2
  echo "If that is intentional, continue by rerunning with the exact tested commit." >&2
fi

if git merge-base --is-ancestor origin/main "$SOURCE_SHA"; then
  echo "==> Promotion is fast-forward safe"
else
  echo "ERROR: source commit is not a fast-forward of origin/main" >&2
  exit 1
fi

echo "==> Switching workspace to main"
git checkout main >/dev/null 2>&1

echo "==> Fast-forwarding local main to source commit"
git merge --ff-only "$SOURCE_SHA"

echo "==> Pushing main to GitHub"
git push origin main

echo "==> Deploying production checkout on Mac mini"
"$DEPLOY_PROD_SCRIPT"

echo "==> Final status"
"$STATUS_SCRIPT"

echo "==> Production should now be live at $PROD_URL"
echo "==> Live commit: $(git rev-parse HEAD)"
