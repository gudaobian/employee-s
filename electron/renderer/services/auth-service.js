/**
 * 认证服务 - 渲染进程代理版本
 *
 * 职责：
 * 1. 作为主进程认证服务的代理
 * 2. 管理本地认证状态
 * 3. 提供热更新时的状态保存/恢复
 *
 * 注意：实际的认证逻辑在主进程，此类主要负责状态管理和 UI 交互
 */

class AuthService extends EventEmitter {
  constructor(config) {
    super();

    this.config = config || {};
    this.deviceId = config.deviceId || null;
    this.apiUrl = config.apiUrl || '';

    // 本地状态
    this.token = null;
    this.isAuthenticated = false;
    this.lastAuthTime = null;
    this.authError = null;

    console.log('[AuthService] Instance created with config:', {
      apiUrl: this.apiUrl,
      hasDeviceId: !!this.deviceId
    });
  }

  /**
   * 初始化
   */
  async init() {
    console.log('[AuthService] Initializing...');

    // 可以在这里从主进程获取初始状态
    // 目前使用本地状态即可

    console.log('[AuthService] Initialized');
  }

  /**
   * 执行认证
   * 注意：实际认证由主进程处理，这里主要通知主进程
   */
  async authenticate() {
    console.log('[AuthService] Authenticating...');

    try {
      // 模拟认证（实际由主进程的 FSM 处理）
      this.token = 'renderer-token-' + Date.now();
      this.isAuthenticated = true;
      this.lastAuthTime = Date.now();
      this.authError = null;

      console.log('[AuthService] Authentication successful');
      this.emit('authenticated', { token: this.token });

      return {
        success: true,
        token: this.token
      };

    } catch (error) {
      console.error('[AuthService] Authentication failed:', error);

      this.isAuthenticated = false;
      this.authError = error.message;

      this.emit('auth-failed', { error: error.message });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取当前 token
   */
  getToken() {
    return this.token;
  }

  /**
   * 检查是否已认证
   */
  isAuth() {
    return this.isAuthenticated;
  }

  /**
   * 清除认证状态
   */
  clearAuth() {
    console.log('[AuthService] Clearing authentication');

    this.token = null;
    this.isAuthenticated = false;
    this.authError = null;

    this.emit('auth-cleared');
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    console.log('[AuthService] Updating config:', newConfig);

    if (newConfig.apiUrl) {
      this.apiUrl = newConfig.apiUrl;
    }

    if (newConfig.deviceId) {
      this.deviceId = newConfig.deviceId;
    }

    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 保存状态（用于热更新）
   */
  saveState() {
    return {
      token: this.token,
      isAuthenticated: this.isAuthenticated,
      lastAuthTime: this.lastAuthTime,
      deviceId: this.deviceId,
      apiUrl: this.apiUrl
    };
  }

  /**
   * 恢复状态（热更新后）
   */
  restoreState(savedState) {
    if (!savedState) return;

    console.log('[AuthService] Restoring state');

    this.token = savedState.token || null;
    this.isAuthenticated = savedState.isAuthenticated || false;
    this.lastAuthTime = savedState.lastAuthTime || null;
    this.deviceId = savedState.deviceId || this.deviceId;
    this.apiUrl = savedState.apiUrl || this.apiUrl;

    this.emit('state-restored', {
      isAuthenticated: this.isAuthenticated
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    console.log('[AuthService] Cleaning up...');

    this.clearAuth();
    this.removeAllListeners();

    console.log('[AuthService] Cleanup complete');
  }
}

// 导出（浏览器环境）
