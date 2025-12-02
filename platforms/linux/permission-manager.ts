/**
 * Linux Permission Manager
 *
 * Comprehensive permission management for Linux platform.
 * Handles input device access, X11/Wayland display access,
 * and required tool detection.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Comprehensive Linux permission status
 */
export interface LinuxPermissionStatus {
    /** Whether current user is a member of the input group */
    isInputGroupMember: boolean;
    /** Name of the input group (usually 'input') */
    inputGroupName: string;
    /** Whether user has access to /dev/input devices */
    hasDevInputAccess: boolean;
    /** List of accessible /dev/input/event* devices */
    accessibleDevices: string[];
    /** Whether X11 display is available */
    hasX11Access: boolean;
    /** X11 DISPLAY value if available */
    x11Display: string | null;
    /** Whether Wayland portal is available */
    hasWaylandPortal: boolean;
    /** XDG Desktop Portal version if available */
    portalVersion: string | null;
    /** Screenshot tools availability */
    screenshotTools: {
        scrot: boolean;
        grim: boolean;
        gnomeScreenshot: boolean;
        spectacle: boolean;
    };
    /** Window management tools availability */
    windowTools: {
        xdotool: boolean;
        xprop: boolean;
        gdbus: boolean;
    };
    /** Idle time detection tools availability */
    idleTools: {
        xprintidle: boolean;
    };
    /** Overall permission status */
    overallStatus: 'full' | 'partial' | 'minimal' | 'none';
    /** List of missing components */
    missingComponents: string[];
    /** Recommendations for fixing permissions */
    recommendations: string[];
}

/**
 * Linux Permission Manager Class
 *
 * Provides comprehensive permission checking and setup guidance
 * for Linux-specific monitoring capabilities.
 */
export class LinuxPermissionManager {
    private cachedStatus: LinuxPermissionStatus | null = null;
    private cacheTime: number = 0;
    private readonly CACHE_TTL_MS = 30000; // 30 seconds cache

    /**
     * Check all permissions and return comprehensive status
     */
    async checkAllPermissions(): Promise<LinuxPermissionStatus> {
        // Return cached result if still valid
        const now = Date.now();
        if (this.cachedStatus && (now - this.cacheTime) < this.CACHE_TTL_MS) {
            return this.cachedStatus;
        }

        // Run all checks in parallel for efficiency
        const [
            inputGroupResult,
            devInputAccess,
            x11Access,
            waylandPortal,
            screenshotTools,
            windowTools,
            idleTools
        ] = await Promise.all([
            this.checkInputGroupMembership(),
            this.checkDevInputAccess(),
            this.checkX11Access(),
            this.checkWaylandPortal(),
            this.checkScreenshotTools(),
            this.checkWindowTools(),
            this.checkIdleTools()
        ]);

        // Build status object
        const status: LinuxPermissionStatus = {
            isInputGroupMember: inputGroupResult.isMember,
            inputGroupName: inputGroupResult.groupName,
            hasDevInputAccess: devInputAccess.length > 0,
            accessibleDevices: devInputAccess,
            hasX11Access: x11Access.available,
            x11Display: x11Access.display,
            hasWaylandPortal: waylandPortal.available,
            portalVersion: waylandPortal.version,
            screenshotTools,
            windowTools,
            idleTools,
            overallStatus: 'none',
            missingComponents: [],
            recommendations: []
        };

        // Calculate overall status and generate recommendations
        this.calculateOverallStatus(status);
        this.generateRecommendations(status);

        // Cache the result
        this.cachedStatus = status;
        this.cacheTime = now;

        return status;
    }

    /**
     * Check if current user is a member of the input group
     */
    async checkInputGroupMembership(): Promise<{ isMember: boolean; groupName: string }> {
        try {
            // Get current user's groups
            const { stdout: groupsOutput } = await execAsync('groups');
            const userGroups = groupsOutput.trim().split(/\s+/);

            // Check for common input group names
            const inputGroupNames = ['input', 'plugdev', 'uinput'];

            for (const groupName of inputGroupNames) {
                if (userGroups.includes(groupName)) {
                    return { isMember: true, groupName };
                }
            }

            // Try to find the actual input group name
            try {
                const { stdout: inputGroup } = await execAsync('getent group input');
                if (inputGroup.trim()) {
                    return { isMember: false, groupName: 'input' };
                }
            } catch {
                // Group doesn't exist
            }

            return { isMember: false, groupName: 'input' };
        } catch (error) {
            console.error('[LINUX_PERM] Failed to check input group membership:', error);
            return { isMember: false, groupName: 'input' };
        }
    }

    /**
     * Check access to /dev/input devices
     */
    async checkDevInputAccess(): Promise<string[]> {
        const accessibleDevices: string[] = [];
        const devInputPath = '/dev/input';

        try {
            // Check if /dev/input directory exists
            if (!fs.existsSync(devInputPath)) {
                return accessibleDevices;
            }

            // List all event devices
            const files = await fs.promises.readdir(devInputPath);
            const eventDevices = files.filter(f => f.startsWith('event'));

            // Try to open each device
            for (const device of eventDevices) {
                const devicePath = path.join(devInputPath, device);
                try {
                    // Try to open the device for reading
                    const fd = await fs.promises.open(devicePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
                    await fd.close();
                    accessibleDevices.push(devicePath);
                } catch {
                    // Device not accessible
                }
            }
        } catch (error) {
            console.error('[LINUX_PERM] Failed to check /dev/input access:', error);
        }

        return accessibleDevices;
    }

    /**
     * Check X11 display access
     */
    async checkX11Access(): Promise<{ available: boolean; display: string | null }> {
        const display = process.env.DISPLAY || null;

        if (!display) {
            return { available: false, display: null };
        }

        try {
            // Verify X11 connection with xdpyinfo
            await execAsync('xdpyinfo -display ' + display + ' > /dev/null 2>&1');
            return { available: true, display };
        } catch {
            // xdpyinfo not available or failed, try alternative
            try {
                await execAsync('xset q > /dev/null 2>&1');
                return { available: true, display };
            } catch {
                return { available: false, display };
            }
        }
    }

    /**
     * Check Wayland portal availability
     */
    async checkWaylandPortal(): Promise<{ available: boolean; version: string | null }> {
        const waylandDisplay = process.env.WAYLAND_DISPLAY;

        if (!waylandDisplay) {
            return { available: false, version: null };
        }

        try {
            // Check if xdg-desktop-portal is running
            const { stdout } = await execAsync('busctl --user list | grep -i portal');

            if (stdout.includes('portal')) {
                // Try to get portal version
                try {
                    const { stdout: versionOutput } = await execAsync(
                        'busctl --user introspect org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop 2>/dev/null | grep -i version || echo ""'
                    );
                    const versionMatch = versionOutput.match(/version\s*=\s*(\d+)/i);
                    return {
                        available: true,
                        version: versionMatch ? versionMatch[1] : null
                    };
                } catch {
                    return { available: true, version: null };
                }
            }
        } catch {
            // busctl not available or portal not running
        }

        // Alternative check using gdbus
        try {
            await execAsync('gdbus introspect --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop > /dev/null 2>&1');
            return { available: true, version: null };
        } catch {
            return { available: false, version: null };
        }
    }

    /**
     * Check screenshot tool availability
     */
    async checkScreenshotTools(): Promise<{
        scrot: boolean;
        grim: boolean;
        gnomeScreenshot: boolean;
        spectacle: boolean;
    }> {
        const [scrot, grim, gnomeScreenshot, spectacle] = await Promise.all([
            this.commandExists('scrot'),
            this.commandExists('grim'),
            this.commandExists('gnome-screenshot'),
            this.commandExists('spectacle')
        ]);

        return { scrot, grim, gnomeScreenshot, spectacle };
    }

    /**
     * Check window management tool availability
     */
    async checkWindowTools(): Promise<{
        xdotool: boolean;
        xprop: boolean;
        gdbus: boolean;
    }> {
        const [xdotool, xprop, gdbus] = await Promise.all([
            this.commandExists('xdotool'),
            this.commandExists('xprop'),
            this.commandExists('gdbus')
        ]);

        return { xdotool, xprop, gdbus };
    }

    /**
     * Check idle time detection tool availability
     */
    async checkIdleTools(): Promise<{ xprintidle: boolean }> {
        const xprintidle = await this.commandExists('xprintidle');
        return { xprintidle };
    }

    /**
     * Check if a command exists in PATH
     */
    private async commandExists(command: string): Promise<boolean> {
        try {
            await execAsync(`which ${command}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Calculate overall permission status
     */
    private calculateOverallStatus(status: LinuxPermissionStatus): void {
        let score = 0;
        const maxScore = 10;

        // Input access (3 points)
        if (status.hasDevInputAccess && status.accessibleDevices.length >= 2) {
            score += 3;
        } else if (status.hasDevInputAccess) {
            score += 1;
        }

        // Display access (2 points)
        if (status.hasX11Access) {
            score += 2;
        } else if (status.hasWaylandPortal) {
            score += 2;
        }

        // Screenshot tools (2 points)
        const screenshotAvailable = Object.values(status.screenshotTools).some(v => v);
        if (screenshotAvailable) {
            score += 2;
        }

        // Window tools (2 points)
        if (status.windowTools.xdotool && status.windowTools.xprop) {
            score += 2;
        } else if (status.windowTools.xdotool || status.windowTools.gdbus) {
            score += 1;
        }

        // Idle tools (1 point)
        if (status.idleTools.xprintidle) {
            score += 1;
        }

        // Determine overall status
        if (score >= 9) {
            status.overallStatus = 'full';
        } else if (score >= 6) {
            status.overallStatus = 'partial';
        } else if (score >= 3) {
            status.overallStatus = 'minimal';
        } else {
            status.overallStatus = 'none';
        }

        // Build missing components list
        if (!status.isInputGroupMember) {
            status.missingComponents.push('input_group_membership');
        }
        if (!status.hasDevInputAccess) {
            status.missingComponents.push('dev_input_access');
        }
        if (!status.hasX11Access && !status.hasWaylandPortal) {
            status.missingComponents.push('display_access');
        }
        if (!Object.values(status.screenshotTools).some(v => v)) {
            status.missingComponents.push('screenshot_tools');
        }
        if (!status.windowTools.xdotool && !status.windowTools.gdbus) {
            status.missingComponents.push('window_tools');
        }
        if (!status.idleTools.xprintidle) {
            status.missingComponents.push('idle_tools');
        }
    }

    /**
     * Generate recommendations based on missing permissions
     */
    private generateRecommendations(status: LinuxPermissionStatus): void {
        if (!status.isInputGroupMember) {
            status.recommendations.push(
                `Add user to input group: sudo usermod -aG ${status.inputGroupName} $USER`
            );
            status.recommendations.push(
                'Log out and log back in (or reboot) for group changes to take effect'
            );
        }

        if (!status.hasDevInputAccess && status.isInputGroupMember) {
            status.recommendations.push(
                'Create udev rule for input device access (see setup instructions)'
            );
        }

        if (!status.hasX11Access && !status.hasWaylandPortal) {
            if (process.env.WAYLAND_DISPLAY) {
                status.recommendations.push(
                    'Install xdg-desktop-portal for Wayland support: sudo apt install xdg-desktop-portal xdg-desktop-portal-gtk'
                );
            } else {
                status.recommendations.push(
                    'Ensure X11 display server is running and DISPLAY environment variable is set'
                );
            }
        }

        if (!Object.values(status.screenshotTools).some(v => v)) {
            if (status.hasX11Access) {
                status.recommendations.push(
                    'Install screenshot tool: sudo apt install scrot'
                );
            } else if (status.hasWaylandPortal) {
                status.recommendations.push(
                    'Install Wayland screenshot tool: sudo apt install grim'
                );
            }
        }

        if (!status.windowTools.xdotool && status.hasX11Access) {
            status.recommendations.push(
                'Install window tracking tools: sudo apt install xdotool xprop'
            );
        }

        if (!status.idleTools.xprintidle && status.hasX11Access) {
            status.recommendations.push(
                'Install idle time detection: sudo apt install xprintidle'
            );
        }
    }

    /**
     * Generate detailed setup instructions based on current permission status
     */
    generateSetupInstructions(status: LinuxPermissionStatus): string {
        const lines: string[] = [];
        const distro = this.detectDistribution();

        lines.push('=== Linux Permission Setup Instructions ===');
        lines.push('');
        lines.push(`Detected Distribution: ${distro}`);
        lines.push(`Current Status: ${status.overallStatus.toUpperCase()}`);
        lines.push('');

        // Step 1: Input Group
        if (!status.isInputGroupMember || !status.hasDevInputAccess) {
            lines.push('### Step 1: Configure Input Device Access');
            lines.push('');
            lines.push('Add your user to the input group:');
            lines.push('```bash');
            lines.push(`sudo usermod -aG ${status.inputGroupName} $USER`);
            lines.push('```');
            lines.push('');
            lines.push('Create udev rules for input device access:');
            lines.push('```bash');
            lines.push('sudo tee /etc/udev/rules.d/99-input-monitor.rules << EOF');
            lines.push(this.generateUdevRules());
            lines.push('EOF');
            lines.push('```');
            lines.push('');
            lines.push('Reload udev rules:');
            lines.push('```bash');
            lines.push('sudo udevadm control --reload-rules');
            lines.push('sudo udevadm trigger');
            lines.push('```');
            lines.push('');
            lines.push('**IMPORTANT**: Log out and log back in (or reboot) for changes to take effect.');
            lines.push('');
        }

        // Step 2: Install Required Tools
        const missingTools: string[] = [];

        if (!Object.values(status.screenshotTools).some(v => v)) {
            if (status.hasX11Access) {
                missingTools.push('scrot');
            } else {
                missingTools.push('grim');
            }
        }

        if (!status.windowTools.xdotool && status.hasX11Access) {
            missingTools.push('xdotool');
        }

        if (!status.windowTools.xprop && status.hasX11Access) {
            missingTools.push('xprop');
        }

        if (!status.idleTools.xprintidle && status.hasX11Access) {
            missingTools.push('xprintidle');
        }

        if (!status.hasWaylandPortal && process.env.WAYLAND_DISPLAY) {
            missingTools.push('xdg-desktop-portal');
            missingTools.push('xdg-desktop-portal-gtk');
        }

        if (missingTools.length > 0) {
            lines.push('### Step 2: Install Required Tools');
            lines.push('');

            switch (distro) {
                case 'ubuntu':
                case 'debian':
                case 'linuxmint':
                case 'pop':
                    lines.push('```bash');
                    lines.push(`sudo apt install -y ${missingTools.join(' ')}`);
                    lines.push('```');
                    break;
                case 'fedora':
                case 'rhel':
                case 'centos':
                    lines.push('```bash');
                    lines.push(`sudo dnf install -y ${missingTools.join(' ')}`);
                    lines.push('```');
                    break;
                case 'arch':
                case 'manjaro':
                    lines.push('```bash');
                    lines.push(`sudo pacman -S ${missingTools.join(' ')}`);
                    lines.push('```');
                    break;
                case 'opensuse':
                    lines.push('```bash');
                    lines.push(`sudo zypper install ${missingTools.join(' ')}`);
                    lines.push('```');
                    break;
                default:
                    lines.push('Install the following packages using your distribution\'s package manager:');
                    lines.push('```');
                    lines.push(missingTools.join(' '));
                    lines.push('```');
            }
            lines.push('');
        }

        // Step 3: Native Module Build (if needed)
        lines.push('### Step 3: Build Native Event Monitor (Optional)');
        lines.push('');
        lines.push('For enhanced input monitoring, build the native module:');
        lines.push('');
        lines.push('Install build dependencies:');

        switch (distro) {
            case 'ubuntu':
            case 'debian':
            case 'linuxmint':
            case 'pop':
                lines.push('```bash');
                lines.push('sudo apt install -y build-essential libinput-dev libudev-dev libx11-dev libxtst-dev');
                lines.push('```');
                break;
            case 'fedora':
            case 'rhel':
            case 'centos':
                lines.push('```bash');
                lines.push('sudo dnf install -y gcc-c++ libinput-devel systemd-devel libX11-devel libXtst-devel');
                lines.push('```');
                break;
            case 'arch':
            case 'manjaro':
                lines.push('```bash');
                lines.push('sudo pacman -S base-devel libinput libx11 libxtst');
                lines.push('```');
                break;
            default:
                lines.push('Install: build-essential, libinput-dev, libudev-dev, libx11-dev, libxtst-dev');
        }

        lines.push('');
        lines.push('Build the native module:');
        lines.push('```bash');
        lines.push('cd native-event-monitor-linux');
        lines.push('npm run build:native');
        lines.push('```');
        lines.push('');

        // Verification
        lines.push('### Verification');
        lines.push('');
        lines.push('After completing the setup, restart the application to verify permissions.');
        lines.push('');
        lines.push('Current permission summary:');
        lines.push(`- Input Group Member: ${status.isInputGroupMember ? 'Yes' : 'No'}`);
        lines.push(`- Device Access: ${status.accessibleDevices.length} devices`);
        lines.push(`- X11 Access: ${status.hasX11Access ? 'Yes' : 'No'}`);
        lines.push(`- Wayland Portal: ${status.hasWaylandPortal ? 'Yes' : 'No'}`);
        lines.push(`- Screenshot Tools: ${Object.entries(status.screenshotTools).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
        lines.push(`- Window Tools: ${Object.entries(status.windowTools).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
        lines.push(`- Idle Tools: ${status.idleTools.xprintidle ? 'xprintidle' : 'None'}`);

        return lines.join('\n');
    }

    /**
     * Generate udev rules for input device access
     */
    generateUdevRules(): string {
        const rules: string[] = [];

        rules.push('# Employee Monitor Input Device Access Rules');
        rules.push('# Generated by LinuxPermissionManager');
        rules.push('');
        rules.push('# Allow input group to read input devices');
        rules.push('KERNEL=="event*", SUBSYSTEM=="input", GROUP="input", MODE="0640"');
        rules.push('');
        rules.push('# Allow access to mice devices');
        rules.push('KERNEL=="mice", SUBSYSTEM=="input", GROUP="input", MODE="0640"');
        rules.push('KERNEL=="mouse*", SUBSYSTEM=="input", GROUP="input", MODE="0640"');
        rules.push('');
        rules.push('# USB input devices');
        rules.push('SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="03", GROUP="input", MODE="0660"');
        rules.push('');
        rules.push('# HID devices');
        rules.push('SUBSYSTEM=="hidraw", GROUP="input", MODE="0660"');

        return rules.join('\n');
    }

    /**
     * Detect Linux distribution
     */
    private detectDistribution(): string {
        try {
            if (fs.existsSync('/etc/os-release')) {
                const content = fs.readFileSync('/etc/os-release', 'utf8');
                const idMatch = content.match(/^ID=(.+)$/m);
                if (idMatch) {
                    return idMatch[1].replace(/"/g, '').toLowerCase();
                }
            }
        } catch {
            // Ignore errors
        }

        try {
            if (fs.existsSync('/etc/lsb-release')) {
                const content = fs.readFileSync('/etc/lsb-release', 'utf8');
                const idMatch = content.match(/DISTRIB_ID=(.+)/);
                if (idMatch) {
                    return idMatch[1].replace(/"/g, '').toLowerCase();
                }
            }
        } catch {
            // Ignore errors
        }

        return 'unknown';
    }

    /**
     * Clear the permission status cache
     */
    clearCache(): void {
        this.cachedStatus = null;
        this.cacheTime = 0;
    }

    /**
     * Get a quick permission summary for logging
     */
    async getQuickSummary(): Promise<string> {
        const status = await this.checkAllPermissions();
        return `Linux Permissions: ${status.overallStatus} | ` +
               `Input: ${status.hasDevInputAccess ? 'OK' : 'NO'} | ` +
               `Display: ${status.hasX11Access ? 'X11' : (status.hasWaylandPortal ? 'Wayland' : 'NO')} | ` +
               `Tools: ${status.missingComponents.length === 0 ? 'All' : status.missingComponents.length + ' missing'}`;
    }
}

export default LinuxPermissionManager;
