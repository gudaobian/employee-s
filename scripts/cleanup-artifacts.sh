#!/bin/bash

# GitHub Artifacts Cleanup Script
# Deletes old artifacts to free up storage quota
#
# Prerequisites:
# 1. Install GitHub CLI: https://cli.github.com/
# 2. Authenticate: gh auth login
#
# Usage:
#   ./scripts/cleanup-artifacts.sh [--dry-run]

set -e

REPO="zhangxiaoyu2000/employee-s"
DRY_RUN=false

# Parse arguments
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 DRY RUN MODE - No artifacts will be deleted"
fi

echo "🧹 Cleaning up GitHub Actions artifacts for $REPO"
echo "=================================================="

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) is not installed"
  echo "   Install from: https://cli.github.com/"
  exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
  echo "❌ Not authenticated with GitHub CLI"
  echo "   Run: gh auth login"
  exit 1
fi

# List all artifacts
echo "📋 Fetching artifacts..."
ARTIFACTS=$(gh api "repos/$REPO/actions/artifacts?per_page=100" --jq '.artifacts[] | "\(.id)\t\(.name)\t\(.size_in_bytes)\t\(.created_at)"')

if [ -z "$ARTIFACTS" ]; then
  echo "✅ No artifacts found - storage is clean!"
  exit 0
fi

echo "Found artifacts:"
echo "$ARTIFACTS" | while IFS=$'\t' read -r id name size created; do
  size_mb=$(echo "scale=2; $size / 1048576" | bc)
  echo "  - $name (${size_mb}MB, created: $created)"
done

echo ""
echo "🗑️  Starting deletion process..."

# Delete each artifact
DELETED_COUNT=0
DELETED_SIZE=0

echo "$ARTIFACTS" | while IFS=$'\t' read -r id name size created; do
  size_mb=$(echo "scale=2; $size / 1048576" | bc)

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would delete: $name (${size_mb}MB)"
  else
    echo "  Deleting: $name (${size_mb}MB)..."
    if gh api -X DELETE "repos/$REPO/actions/artifacts/$id" &> /dev/null; then
      echo "    ✅ Deleted"
      DELETED_COUNT=$((DELETED_COUNT + 1))
      DELETED_SIZE=$(echo "$DELETED_SIZE + $size" | bc)
    else
      echo "    ❌ Failed to delete"
    fi
  fi
done

if [ "$DRY_RUN" = false ]; then
  DELETED_SIZE_MB=$(echo "scale=2; $DELETED_SIZE / 1048576" | bc)
  echo ""
  echo "=================================================="
  echo "✅ Cleanup complete!"
  echo "   Deleted: $DELETED_COUNT artifacts"
  echo "   Freed: ${DELETED_SIZE_MB}MB"
  echo ""
  echo "💡 Note: Storage usage recalculates every 6-12 hours"
fi
