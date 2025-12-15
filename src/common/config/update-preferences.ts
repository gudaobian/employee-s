/**
 * Update Preferences
 *
 * Persistent storage for user update preferences using electron-store
 */

import Store from 'electron-store';

export interface UpdatePreferences {
  autoCheckEnabled: boolean;
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
  checkInterval: number; // in milliseconds
  channel: 'stable' | 'beta' | 'dev';
  skippedVersions: string[];
  lastCheckTime?: string;
  lastUpdateTime?: string;
  updateNotificationsEnabled: boolean;
}

const defaultPreferences: UpdatePreferences = {
  autoCheckEnabled: true,
  autoDownload: true,
  autoInstallOnQuit: true,
  checkInterval: 6 * 60 * 60 * 1000, // 6 hours
  channel: 'stable',
  skippedVersions: [],
  updateNotificationsEnabled: true
};

export class UpdatePreferencesStore {
  private store: Store<UpdatePreferences>;

  constructor() {
    this.store = new Store<UpdatePreferences>({
      name: 'update-preferences',
      defaults: defaultPreferences,
      // Encrypt sensitive data
      encryptionKey: 'employee-monitor-update-prefs',
      // Clear invalid data on load errors
      clearInvalidConfig: true
    });
  }

  /**
   * Get all preferences
   */
  get(): UpdatePreferences {
    return this.store.store;
  }

  /**
   * Set multiple preferences at once
   */
  set(preferences: Partial<UpdatePreferences>): void {
    for (const [key, value] of Object.entries(preferences)) {
      this.store.set(key as any, value);
    }
  }

  /**
   * Get single preference value
   */
  getValue<K extends keyof UpdatePreferences>(key: K): UpdatePreferences[K] {
    return this.store.get(key);
  }

  /**
   * Set single preference value
   */
  setValue<K extends keyof UpdatePreferences>(key: K, value: UpdatePreferences[K]): void {
    this.store.set(key, value);
  }

  /**
   * Skip a specific version
   */
  skipVersion(version: string): void {
    const skipped = this.store.get('skippedVersions') || [];
    if (!skipped.includes(version)) {
      skipped.push(version);
      this.store.set('skippedVersions', skipped);
    }
  }

  /**
   * Check if a version is skipped
   */
  isVersionSkipped(version: string): boolean {
    const skipped = this.store.get('skippedVersions') || [];
    return skipped.includes(version);
  }

  /**
   * Clear skipped versions
   */
  clearSkippedVersions(): void {
    this.store.set('skippedVersions', []);
  }

  /**
   * Update last check time
   */
  updateLastCheckTime(): void {
    this.store.set('lastCheckTime', new Date().toISOString());
  }

  /**
   * Update last update time
   */
  updateLastUpdateTime(): void {
    this.store.set('lastUpdateTime', new Date().toISOString());
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.store.clear();
    // Defaults will be applied automatically
  }

  /**
   * Export preferences as JSON
   */
  export(): string {
    return JSON.stringify(this.get(), null, 2);
  }

  /**
   * Import preferences from JSON
   */
  import(json: string): void {
    try {
      const preferences = JSON.parse(json);
      this.set(preferences);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  }

  /**
   * Get preferences file path
   */
  getPath(): string {
    return this.store.path;
  }
}
