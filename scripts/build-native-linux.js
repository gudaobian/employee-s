#!/usr/bin/env node
/**
 * Linux Native Module Build Script
 *
 * Builds the native-event-monitor-linux module with proper dependency checking.
 * Handles multiple Linux distributions (Debian/Ubuntu, Fedora/RHEL, Arch).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NATIVE_MODULE_PATH = path.join(__dirname, '..', 'native-event-monitor-linux');
const ROOT_DIR = path.join(__dirname, '..');

// ANSI colors for terminal output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(color, msg) {
    console.log(`${color}${msg}${colors.reset}`);
}

function logStep(step, total, msg) {
    console.log(`${colors.cyan}[${step}/${total}]${colors.reset} ${msg}`);
}

/**
 * Detect Linux distribution from /etc/os-release
 */
function detectDistro() {
    try {
        if (fs.existsSync('/etc/os-release')) {
            const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
            const idMatch = osRelease.match(/^ID=(.+)$/m);
            const idLikeMatch = osRelease.match(/^ID_LIKE=(.+)$/m);
            const nameMatch = osRelease.match(/^PRETTY_NAME="?(.+?)"?$/m);
            const versionMatch = osRelease.match(/^VERSION_ID="?(.+?)"?$/m);

            return {
                id: idMatch ? idMatch[1].replace(/"/g, '') : 'unknown',
                idLike: idLikeMatch ? idLikeMatch[1].replace(/"/g, '').split(' ') : [],
                name: nameMatch ? nameMatch[1] : 'Unknown Linux',
                version: versionMatch ? versionMatch[1] : 'unknown'
            };
        }
    } catch (err) {
        // Ignore error, return unknown
    }
    return { id: 'unknown', idLike: [], name: 'Unknown Linux', version: 'unknown' };
}

/**
 * Determine package manager type based on distro
 */
function getPackageManagerType(distro) {
    const debianBased = ['debian', 'ubuntu', 'linuxmint', 'pop', 'elementary', 'zorin', 'kali'];
    const rpmBased = ['fedora', 'rhel', 'centos', 'rocky', 'alma', 'opensuse', 'suse'];
    const archBased = ['arch', 'manjaro', 'endeavouros', 'garuda'];

    if (debianBased.includes(distro.id) || distro.idLike.some(id => debianBased.includes(id))) {
        return 'apt';
    }
    if (rpmBased.includes(distro.id) || distro.idLike.some(id => rpmBased.includes(id))) {
        // Check for dnf vs yum
        try {
            execSync('which dnf', { stdio: 'ignore' });
            return 'dnf';
        } catch {
            return 'yum';
        }
    }
    if (archBased.includes(distro.id) || distro.idLike.some(id => archBased.includes(id))) {
        return 'pacman';
    }
    return 'unknown';
}

/**
 * Get required dependencies based on package manager
 */
function getRequiredDependencies(pkgManager) {
    const deps = {
        apt: {
            build: ['build-essential', 'python3', 'pkg-config'],
            runtime: ['libinput-dev', 'libudev-dev', 'libx11-dev', 'libxtst-dev', 'libxi-dev']
        },
        dnf: {
            build: ['gcc-c++', 'make', 'python3', 'pkgconf-pkg-config'],
            runtime: ['libinput-devel', 'systemd-devel', 'libX11-devel', 'libXtst-devel', 'libXi-devel']
        },
        yum: {
            build: ['gcc-c++', 'make', 'python3', 'pkgconfig'],
            runtime: ['libinput-devel', 'systemd-devel', 'libX11-devel', 'libXtst-devel', 'libXi-devel']
        },
        pacman: {
            build: ['base-devel', 'python'],
            runtime: ['libinput', 'libx11', 'libxtst', 'libxi']
        }
    };

    return deps[pkgManager] || { build: [], runtime: [] };
}

/**
 * Check if a package is installed
 */
function isPackageInstalled(pkg, pkgManager) {
    try {
        switch (pkgManager) {
            case 'apt':
                execSync(`dpkg -s ${pkg} 2>/dev/null | grep -q "Status: install ok installed"`, { stdio: 'ignore' });
                return true;
            case 'dnf':
            case 'yum':
                execSync(`rpm -q ${pkg.split(' ')[0]} 2>/dev/null`, { stdio: 'ignore' });
                return true;
            case 'pacman':
                execSync(`pacman -Qi ${pkg} 2>/dev/null`, { stdio: 'ignore' });
                return true;
            default:
                return false;
        }
    } catch {
        return false;
    }
}

/**
 * Check for required build dependencies
 */
function checkDependencies() {
    log(colors.blue, '\n=== Checking build dependencies ===\n');

    const distro = detectDistro();
    log(colors.yellow, `Detected distribution: ${distro.name} (${distro.id})`);

    const pkgManager = getPackageManagerType(distro);
    log(colors.yellow, `Package manager: ${pkgManager}\n`);

    if (pkgManager === 'unknown') {
        log(colors.yellow, 'Warning: Unknown package manager. Skipping dependency check.');
        log(colors.yellow, 'Please ensure you have the following installed:');
        console.log('  - C++ compiler (g++ or clang++)');
        console.log('  - Python 3');
        console.log('  - libinput development headers');
        console.log('  - X11 and XTest development headers');
        console.log('  - udev/systemd development headers');
        return true;
    }

    const deps = getRequiredDependencies(pkgManager);
    const allDeps = [...deps.build, ...deps.runtime];
    const missing = [];

    for (const pkg of allDeps) {
        if (isPackageInstalled(pkg, pkgManager)) {
            log(colors.green, `  [OK] ${pkg}`);
        } else {
            log(colors.red, `  [MISSING] ${pkg}`);
            missing.push(pkg);
        }
    }

    if (missing.length > 0) {
        log(colors.red, `\n[ERROR] Missing ${missing.length} dependencies:`);
        console.log(missing.join(', '));

        let installCmd;
        switch (pkgManager) {
            case 'apt':
                installCmd = `sudo apt install -y ${missing.join(' ')}`;
                break;
            case 'dnf':
                installCmd = `sudo dnf install -y ${missing.join(' ')}`;
                break;
            case 'yum':
                installCmd = `sudo yum install -y ${missing.join(' ')}`;
                break;
            case 'pacman':
                installCmd = `sudo pacman -S --noconfirm ${missing.join(' ')}`;
                break;
        }

        log(colors.yellow, '\nInstall with:');
        console.log(`  ${installCmd}`);

        return false;
    }

    log(colors.green, '\n[OK] All dependencies found');
    return true;
}

/**
 * Check for node-gyp and required tools
 */
function checkBuildTools() {
    log(colors.blue, '\n=== Checking build tools ===\n');

    const tools = [
        { name: 'Node.js', cmd: 'node --version' },
        { name: 'npm', cmd: 'npm --version' },
        { name: 'Python', cmd: 'python3 --version' },
        { name: 'node-gyp', cmd: 'npx node-gyp --version' },
        { name: 'pkg-config', cmd: 'pkg-config --version' }
    ];

    let allFound = true;

    for (const tool of tools) {
        try {
            const version = execSync(tool.cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
            log(colors.green, `  [OK] ${tool.name}: ${version}`);
        } catch {
            log(colors.red, `  [MISSING] ${tool.name}`);
            allFound = false;
        }
    }

    if (!allFound) {
        log(colors.red, '\n[ERROR] Some build tools are missing.');
        return false;
    }

    log(colors.green, '\n[OK] All build tools found');
    return true;
}

/**
 * Build the native module
 */
function buildNativeModule() {
    log(colors.blue, '\n=== Building native-event-monitor-linux ===\n');

    if (!fs.existsSync(NATIVE_MODULE_PATH)) {
        log(colors.yellow, `Native module directory not found: ${NATIVE_MODULE_PATH}`);
        log(colors.yellow, 'The native-event-monitor-linux module needs to be created first.');
        log(colors.yellow, 'Skipping native module build...');
        return true; // Return true to allow build to continue
    }

    const originalDir = process.cwd();

    try {
        process.chdir(NATIVE_MODULE_PATH);

        // Install dependencies
        logStep(1, 3, 'Installing npm dependencies...');
        execSync('npm install', { stdio: 'inherit' });

        // Build native module with node-gyp
        logStep(2, 3, 'Compiling native module...');
        execSync('npm run build:native', { stdio: 'inherit' });

        // Build TypeScript if applicable
        if (fs.existsSync(path.join(NATIVE_MODULE_PATH, 'tsconfig.json'))) {
            logStep(3, 3, 'Compiling TypeScript...');
            execSync('npm run build:ts', { stdio: 'inherit' });
        } else {
            logStep(3, 3, 'TypeScript compilation skipped (no tsconfig.json)');
        }

        log(colors.green, '\n[OK] Native module built successfully');

        // Verify output
        const buildPath = path.join(NATIVE_MODULE_PATH, 'build', 'Release', 'linux_event_monitor.node');
        if (fs.existsSync(buildPath)) {
            const stats = fs.statSync(buildPath);
            log(colors.green, `  Output: ${buildPath} (${Math.round(stats.size / 1024)} KB)`);
        }

        return true;

    } catch (error) {
        log(colors.red, `\n[ERROR] Build failed: ${error.message}`);
        return false;
    } finally {
        process.chdir(originalDir);
    }
}

/**
 * Copy built module to resources directory
 */
function copyToResources() {
    log(colors.blue, '\n=== Copying to resources ===\n');

    const srcDir = path.join(NATIVE_MODULE_PATH, 'build', 'Release');
    const destDir = path.join(ROOT_DIR, 'resources', 'native-modules', 'linux');

    if (!fs.existsSync(srcDir)) {
        log(colors.yellow, 'Source build directory not found. Skipping resource copy.');
        return true;
    }

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        log(colors.green, `  Created directory: ${destDir}`);
    }

    const files = ['linux_event_monitor.node'];
    let copied = 0;

    for (const file of files) {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);

        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            log(colors.green, `  [OK] Copied ${file}`);
            copied++;
        } else {
            log(colors.yellow, `  [SKIP] ${file} not found`);
        }
    }

    if (copied > 0) {
        log(colors.green, `\n[OK] Copied ${copied} file(s) to resources`);
    }

    return true;
}

/**
 * Verify Electron rebuild compatibility
 */
function verifyElectronCompatibility() {
    log(colors.blue, '\n=== Verifying Electron compatibility ===\n');

    try {
        // Get Electron version
        const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
        const electronVersion = pkgJson.devDependencies?.electron || pkgJson.dependencies?.electron;

        if (electronVersion) {
            log(colors.green, `  Electron version: ${electronVersion}`);
            log(colors.yellow, '  Note: Run electron-rebuild after native module compilation');
            log(colors.yellow, '  Command: npx electron-rebuild');
        }

        return true;
    } catch (error) {
        log(colors.yellow, `  Warning: Could not verify Electron version: ${error.message}`);
        return true;
    }
}

/**
 * Print build summary
 */
function printSummary(success) {
    console.log('\n' + '='.repeat(60));

    if (success) {
        log(colors.green + colors.bold, '\n  Linux Native Build Complete!\n');
        console.log('  Next steps:');
        console.log('  1. Run: npx electron-rebuild');
        console.log('  2. Test: npm run test');
        console.log('  3. Package: npm run pack:linux');
    } else {
        log(colors.red + colors.bold, '\n  Linux Native Build Failed!\n');
        console.log('  Troubleshooting:');
        console.log('  1. Check that all dependencies are installed');
        console.log('  2. Verify node-gyp can compile native modules');
        console.log('  3. Check the error messages above');
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * Main build process
 */
async function main() {
    console.log('\n' + '='.repeat(60));
    log(colors.cyan + colors.bold, '  Linux Native Module Build Script');
    console.log('='.repeat(60));

    // Check platform
    if (process.platform !== 'linux') {
        log(colors.yellow, '\nWarning: This script is intended for Linux.');
        log(colors.yellow, `Current platform: ${process.platform}`);
        log(colors.yellow, 'Build will continue for testing purposes...\n');
    }

    let success = true;

    // Step 1: Check dependencies
    if (!checkDependencies()) {
        log(colors.yellow, '\nContinuing despite missing dependencies...');
        // Don't fail here, continue to see what else might work
    }

    // Step 2: Check build tools
    if (!checkBuildTools()) {
        log(colors.red, '\nBuild tools check failed. Please install missing tools.');
        success = false;
    }

    // Step 3: Build native module
    if (success && !buildNativeModule()) {
        success = false;
    }

    // Step 4: Copy to resources
    if (success) {
        copyToResources();
    }

    // Step 5: Verify Electron compatibility
    if (success) {
        verifyElectronCompatibility();
    }

    // Print summary
    printSummary(success);

    process.exit(success ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        log(colors.red, `\nFatal error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    detectDistro,
    getPackageManagerType,
    checkDependencies,
    checkBuildTools,
    buildNativeModule,
    copyToResources
};
