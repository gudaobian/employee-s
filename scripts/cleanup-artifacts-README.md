# Artifact Storage Cleanup

## Problem

GitHub Actions has artifact storage limits:
- **Free accounts**: 500MB storage
- **Pro accounts**: 2GB storage
- Usage recalculates every 6-12 hours

When quota is exceeded, builds fail with:
```
Error: Failed to CreateArtifact: Artifact storage quota has been hit.
```

## Solution 1: Manual Cleanup (Recommended)

1. Go to https://github.com/zhangxiaoyu2000/employee-s/actions
2. Click on each workflow run
3. Scroll to "Artifacts" section at the bottom
4. Click trash icon to delete artifacts
5. **Priority**: Delete artifacts from failed/old builds first

## Solution 2: Automated Cleanup Script

### Prerequisites
```bash
# Install GitHub CLI
brew install gh  # macOS
# or download from https://cli.github.com/

# Authenticate
gh auth login
```

### Usage
```bash
# Dry run (preview what will be deleted)
./scripts/cleanup-artifacts.sh --dry-run

# Actually delete artifacts
./scripts/cleanup-artifacts.sh
```

## Prevention

The workflow has been updated to:
- Reduce retention from 30 days to 1 day
- Artifacts auto-delete after release creation
- Only keep necessary build outputs

## Storage Monitoring

Check current storage usage:
```bash
gh api /repos/zhangxiaoyu2000/employee-s/actions/cache/usage
```

## Alternative: Skip Artifact Upload

If storage is critically low, you can temporarily skip intermediate artifacts and only upload the final release:

1. Comment out artifact upload steps in `.github/workflows/build-and-release.yml`
2. Only the final GitHub Release will be created (no intermediate artifacts)

## Notes

- Storage quota recalculates every 6-12 hours
- Deleting artifacts frees space immediately, but GitHub may take time to reflect it
- Failed builds often leave orphaned artifacts - clean these first
