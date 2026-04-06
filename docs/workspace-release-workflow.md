# Workspace-First Release Workflow

This is the simple version.

## Environments

- **Workspace repo:** `/Volumes/External/hermes-workspace/projects/lunarpad`
- **Staging URL:** `https://decks.satsdisco.com`
- **Production URL:** `https://lunarpad.dev`

## Branches

- `staging` -> deploys to staging
- `main` -> deploys to production

## Commands

### Send current staged/approved code to staging
```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/push-staging-and-deploy.sh
```

### Promote tested staging code to production
```bash
/Volumes/External/hermes-workspace/projects/lunarpad/scripts/promote-staging-to-main-and-deploy.sh
```

## Safe flow

1. Build feature in workspace on a feature branch
2. Merge/ff it into local `staging`
3. Run `push-staging-and-deploy.sh`
4. Test on `decks.satsdisco.com`
5. Run `promote-staging-to-main-and-deploy.sh`
6. Verify `lunarpad.dev`

## Why this exists

The live Mac mini uses separate runtime checkouts for staging and prod.
Those checkouts should follow GitHub, not become the place we do normal development.
