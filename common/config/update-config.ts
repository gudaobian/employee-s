/**
 * Update Configuration Service
 *
 * Manages update system configuration including:
 * - Update server URL
 * - Update channel (stable, beta, dev)
 * - Auto-download and auto-install settings
 * - Check interval
 */

export interface UpdateConfig {
  enabled: boolean;
  checkInterval: number;
  updateServerUrl: string;
  channel: 'stable' | 'beta' | 'dev';
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
}

export class UpdateConfigService {
  private config: UpdateConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from environment variables with defaults
   */
  private loadConfig(): UpdateConfig {
    return {
      enabled: this.parseBoolean(process.env.UPDATE_ENABLED, true),
      checkInterval: this.parseNumber(
        process.env.UPDATE_CHECK_INTERVAL,
        2 * 60 * 1000 // 2 minutes for testing (default was 6 hours)
      ),
      updateServerUrl:
        process.env.UPDATE_SERVER_URL ||
        'https://api.example.com/api/v1/updates',
      channel: this.parseChannel(process.env.UPDATE_CHANNEL, 'stable'),
      autoDownload: this.parseBoolean(process.env.UPDATE_AUTO_DOWNLOAD, true),
      autoInstallOnQuit: this.parseBoolean(
        process.env.UPDATE_AUTO_INSTALL,
        true
      )
    };
  }

  /**
   * Parse boolean environment variable
   */
  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value === 'true' || value === '1';
  }

  /**
   * Parse number environment variable
   */
  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse update channel
   */
  private parseChannel(
    value: string | undefined,
    defaultValue: 'stable' | 'beta' | 'dev'
  ): 'stable' | 'beta' | 'dev' {
    if (!value) return defaultValue;

    const channel = value.toLowerCase();
    if (channel === 'stable' || channel === 'beta' || channel === 'dev') {
      return channel;
    }

    return defaultValue;
  }

  /**
   * Get current configuration
   */
  getConfig(): UpdateConfig {
    return { ...this.config };
  }

  /**
   * Update server URL
   */
  setUpdateServerUrl(url: string): void {
    this.config.updateServerUrl = url;
  }

  /**
   * Set update channel
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    this.config.channel = channel;
  }

  /**
   * Set auto-download preference
   */
  setAutoDownload(enabled: boolean): void {
    this.config.autoDownload = enabled;
  }

  /**
   * Set auto-install preference
   */
  setAutoInstallOnQuit(enabled: boolean): void {
    this.config.autoInstallOnQuit = enabled;
  }

  /**
   * Set check interval
   */
  setCheckInterval(intervalMs: number): void {
    if (intervalMs < 60000) {
      throw new Error('Check interval must be at least 1 minute (60000ms)');
    }
    this.config.checkInterval = intervalMs;
  }

  /**
   * Enable or disable updates
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}
