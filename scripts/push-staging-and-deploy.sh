#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_REPO="/Volumes/External/hermes-workspace/projects/lunarpad"
BRANCH="staging"
STAGING_URL="https://decks.satsdisco.com"
DEPLOY_SCRIPT="/Volumes/External/openclaw-workspace-v2/scripts/lunarpad-deploy-staging.sh"
STATUS_SCRIPT="/Volumes/External/openclaw-workspace-v2/scripts/lunarpad-status.sh"

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

echo "==> Switching to $BRANCH"
git checkout "$BRANCH" >/dev/null 2>&1 || git checkout -b "$BRANCH" --track "origin/$BRANCH"

echo "==> Verifying branch tracks origin/$BRANCH"
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, got $current_branch" >&2
  exit 1
fi

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/$BRANCH)"

echo "==> Local staging SHA:  $local_sha"
echo "==> Remote staging SHA: $remote_sha"

if git merge-base --is-ancestor origin/$BRANCH HEAD; then
  echo "==> Push is fast-forward safe"
else
  echo "ERROR: local $BRANCH is not a fast-forward of origin/$BRANCH" >&2
  echo "Pull/rebase/fix history before deploying." >&2
  exit 1
fi

echo "==> Pushing workspace $BRANCH to GitHub"
git push origin "$BRANCH"

echo "==> Deploying staging checkout on Mac mini"
"$DEPLOY_SCRIPT"

echo "==> Final status"
"$STATUS_SCRIPT"

echo "==> Staging should now be live at $STAGING_URL"
echo "==> Deployed commit: $(git rev-parse HEAD)"
