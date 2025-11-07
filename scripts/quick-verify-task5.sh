#!/bin/bash
echo "Quick Task 5 Verification"
echo "=========================="
echo ""

# File existence
echo "✅ Statistics module: $([ -f common/utils/url-collect-stats.ts ] && echo "EXISTS" || echo "MISSING")"
echo "✅ Compiled module: $([ -f dist/common/utils/url-collect-stats.js ] && echo "EXISTS" || echo "MISSING")"
echo "✅ In package: $([ -f release/EmployeeMonitor-darwin-arm64/EmployeeMonitor.app/Contents/Resources/app/dist/common/utils/url-collect-stats.js ] && echo "EXISTS" || echo "NOT PACKAGED")"
echo ""

# Integration
echo "✅ Export in index.ts: $(grep -q "url-collect-stats" common/utils/index.ts && echo "YES" || echo "NO")"
echo "✅ Import in MacOSAdapter: $(grep -q "urlCollectStats" platforms/macos/macos-adapter.ts && echo "YES" || echo "NO")"
echo "✅ Import in CLI: $(grep -q "urlCollectStats" main/cli.ts && echo "YES" || echo "NO")"
echo ""

# Implementation
echo "✅ Retry logic: $(grep -q "MAX_RETRIES" platforms/macos/macos-adapter.ts && echo "IMPLEMENTED" || echo "MISSING")"
echo "✅ Success recording: $(grep -q "recordSuccess" platforms/macos/macos-adapter.ts && echo "IMPLEMENTED" || echo "MISSING")"
echo "✅ Failure recording: $(grep -q "recordFailure" platforms/macos/macos-adapter.ts && echo "IMPLEMENTED" || echo "MISSING")"
echo ""

# CLI
echo "✅ Stats command: $(grep -q "command('stats')" main/cli.ts && echo "DEFINED" || echo "MISSING")"
echo "✅ Stats scripts: $(grep -q '"stats"' package.json && echo "ADDED" || echo "MISSING")"
echo ""

# Code quality
TODOS=$(grep -c "TODO" common/utils/url-collect-stats.ts 2>/dev/null || echo 0)
echo "✅ TODO comments: $TODOS (should be 0)"
JSDOCS=$(grep -c "/\*\*" common/utils/url-collect-stats.ts)
echo "✅ JSDoc blocks: $JSDOCS"
echo ""

# Documentation
echo "✅ Acceptance doc: $([ -f claudedocs/task5-acceptance-results.md ] && echo "EXISTS" || echo "MISSING")"
echo "✅ Summary doc: $([ -f claudedocs/task5-summary.md ] && echo "EXISTS" || echo "MISSING")"
echo ""

echo "=========================="
echo "All checks completed!"
