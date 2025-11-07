/**
 * Bundle ID Verification Script
 *
 * CRITICAL: Ensures Bundle ID remains "com.company.employee-monitor" across all configuration files
 * This is essential to preserve macOS permissions (Accessibility, Screen Recording) across updates
 *
 * Run this script before every build and in CI/CD pipeline
 */

import * as fs from 'fs';
import * as path from 'path';

const EXPECTED_BUNDLE_ID = 'com.company.employee-monitor';

interface VerificationResult {
  file: string;
  passed: boolean;
  actual?: string;
  error?: string;
}

class BundleIdVerifier {
  private results: VerificationResult[] = [];

  /**
   * Verify package.json configuration
   */
  private verifyPackageJson(): VerificationResult {
    const file = 'package.json';
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), file), 'utf-8')
      );

      const actualBundleId = packageJson.build?.appId;

      if (!actualBundleId) {
        return {
          file,
          passed: false,
          error: 'Missing build.appId in package.json'
        };
      }

      if (actualBundleId !== EXPECTED_BUNDLE_ID) {
        return {
          file,
          passed: false,
          actual: actualBundleId,
          error: `Bundle ID mismatch in ${file}: expected "${EXPECTED_BUNDLE_ID}", got "${actualBundleId}"`
        };
      }

      return { file, passed: true };
    } catch (error: any) {
      return {
        file,
        passed: false,
        error: `Failed to read ${file}: ${error.message}`
      };
    }
  }

  /**
   * Verify Info.plist (if exists)
   */
  private verifyInfoPlist(): VerificationResult {
    const file = 'electron/Info.plist';
    const filePath = path.join(process.cwd(), file);

    if (!fs.existsSync(filePath)) {
      // Info.plist is optional, skip if not present
      return { file, passed: true };
    }

    try {
      const plistContent = fs.readFileSync(filePath, 'utf-8');

      if (!plistContent.includes(EXPECTED_BUNDLE_ID)) {
        return {
          file,
          passed: false,
          error: `Bundle ID not found in ${file}`
        };
      }

      return { file, passed: true };
    } catch (error: any) {
      return {
        file,
        passed: false,
        error: `Failed to read ${file}: ${error.message}`
      };
    }
  }

  /**
   * Verify notarize.js script
   */
  private verifyNotarizeScript(): VerificationResult {
    const file = 'scripts/notarize.js';
    const filePath = path.join(process.cwd(), file);

    if (!fs.existsSync(filePath)) {
      return {
        file,
        passed: false,
        error: `${file} not found`
      };
    }

    try {
      const scriptContent = fs.readFileSync(filePath, 'utf-8');

      if (!scriptContent.includes(EXPECTED_BUNDLE_ID)) {
        return {
          file,
          passed: false,
          error: `Bundle ID not found in ${file}`
        };
      }

      return { file, passed: true };
    } catch (error: any) {
      return {
        file,
        passed: false,
        error: `Failed to read ${file}: ${error.message}`
      };
    }
  }

  /**
   * Run all verification checks
   */
  public verify(): boolean {
    console.log('🔍 Verifying Bundle ID consistency...\n');
    console.log(`Expected Bundle ID: ${EXPECTED_BUNDLE_ID}\n`);

    this.results = [
      this.verifyPackageJson(),
      this.verifyInfoPlist(),
      this.verifyNotarizeScript()
    ];

    return this.reportResults();
  }

  /**
   * Report verification results
   */
  private reportResults(): boolean {
    let allPassed = true;

    for (const result of this.results) {
      if (result.passed) {
        console.log(`✅ ${result.file}: PASSED`);
      } else {
        console.error(`❌ ${result.file}: FAILED`);
        if (result.error) {
          console.error(`   Error: ${result.error}`);
        }
        if (result.actual) {
          console.error(`   Actual: ${result.actual}`);
        }
        allPassed = false;
      }
    }

    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      console.log('✅ Bundle ID verification PASSED');
      console.log('   All files contain the correct Bundle ID');
    } else {
      console.error('❌ Bundle ID verification FAILED');
      console.error('   CRITICAL: Fix Bundle ID mismatches before building');
      console.error('   Incorrect Bundle ID will cause permission loss on macOS');
    }
    console.log('='.repeat(60) + '\n');

    return allPassed;
  }
}

// Run verification
const verifier = new BundleIdVerifier();
const passed = verifier.verify();

// Exit with error code if verification failed
process.exit(passed ? 0 : 1);
