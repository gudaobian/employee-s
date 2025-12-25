/**
 * FSM 服务 - 渲染进程代理版本
 *
 * 职责：
 * 1. 作为主进程 FSM 的代理，通过 IPC 通信
 * 2. 维护本地状态用于 UI 更新
 * 3. 提供热更新时的状态保存/恢复
 *
 * 注意：核心业务逻辑仍在主进程，此类主要负责 UI 交互
 */

class FSMService extends EventEmitter {
  constructor() {
    super();

    // 本地状态（用于 UI 更新）
    this.currentState = 'INIT';
    this.previousState = null;
    this.isPaused = false;
    this.stateHistory = [];

    // IPC 通信
    this.ipcUnsubscribers = [];

    console.log('[FSMService] Instance created');
  }

  /**
   * 初始化 - 设置 IPC 监听器
   */
  async init() {
    console.log('[FSMService] Initializing...');

    // 监听主进程的 FSM 状态变化
    const unsub1 = window.electronAPI.on('fsm-state-changed', (data) => {
      this.handleStateChange(data);
    });
    this.ipcUnsubscribers.push(unsub1);

    // 监听设备状态变化
    const unsub2 = window.electronAPI.on('device-status-changed', (data) => {
      this.handleDeviceStatusChange(data);
    });
    this.ipcUnsubscribers.push(unsub2);

    // 获取当前状态
    try {
      const currentState = await window.electronAPI.fsm.getCurrentState();
      if (currentState && currentState.state) {
        this.currentState = currentState.state;
        console.log('[FSMService] Current state:', this.currentState);
      }
    } catch (error) {
      console.warn('[FSMService] Failed to get current state:', error.message);
      // 使用默认状态
      this.currentState = 'INIT';
    }

    console.log('[FSMService] Initialized');
  }

  /**
   * 启动 FSM
   */
  async start() {
    console.log('[FSMService] Starting FSM...');

    try {
      // 通知主进程启动 FSM（通过应用启动）
      // 注意：实际的 FSM 启动由主进程的 EmployeeMonitorApp 管理
      this.currentState = 'RUNNING';
      this.emit('state-change', this.currentState);

      console.log('[FSMService] FSM started');
      return { success: true };
    } catch (error) {
      console.error('[FSMService] Failed to start:', error);
      this.emit('error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 停止 FSM
   */
  async stop() {
    console.log('[FSMService] Stopping FSM...');

    try {
      // 通知主进程停止（通过应用停止）
      this.currentState = 'STOPPED';
      this.emit('state-change', this.currentState);

      console.log('[FSMService] FSM stopped');
      return { success: true };
    } catch (error) {
      console.error('[FSMService] Failed to stop:', error);
      this.emit('error', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 暂停监控
   */
  pause() {
    console.log('[FSMService] Pausing...');
    this.isPaused = true;
    this.emit('state-change', 'PAUSED');

    // 通知主进程暂停
    window.electronAPI.send('monitoring-paused', {
      timestamp: Date.now()
    });
  }

  /**
   * 恢复监控
   */
  resume() {
    console.log('[FSMService] Resuming...');
    this.isPaused = false;
    this.emit('state-change', this.currentState);

    // 通知主进程恢复
    window.electronAPI.send('monitoring-resumed', {
      timestamp: Date.now()
    });
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.isPaused ? 'PAUSED' : this.currentState;
  }

  /**
   * 强制状态转换（调试用）
   */
  async forceTransition(targetState) {
    console.log('[FSMService] Force transition to:', targetState);

    try {
      const result = await window.electronAPI.fsm.forceTransition(targetState);

      if (result && result.success) {
        console.log('[FSMService] Transition successful');
        return { success: true };
      } else {
        console.error('[FSMService] Transition failed:', result?.error);
        return { success: false, error: result?.error };
      }
    } catch (error) {
      console.error('[FSMService] Transition error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 处理主进程的状态变化通知
   */
  handleStateChange(data) {
    console.log('[FSMService] State change from main process:', data);

    const { state, previousState, timestamp } = data;

    this.previousState = this.currentState;
    this.currentState = state;

    // 记录状态历史
    this.stateHistory.push({
      from: previousState || this.previousState,
      to: state,
      timestamp: timestamp || Date.now()
    });

    // 保留最近 20 条历史
    if (this.stateHistory.length > 20) {
      this.stateHistory = this.stateHistory.slice(-20);
    }

    // 触发本地事件
    this.emit('state-change', state, previousState);
  }

  /**
   * 处理设备状态变化
   */
  handleDeviceStatusChange(data) {
    console.log('[FSMService] Device status change:', data);
    this.emit('device-status', data);
  }

  /**
   * 保存状态（用于热更新）
   */
  saveState() {
    return {
      currentState: this.currentState,
      previousState: this.previousState,
      isPaused: this.isPaused,
      stateHistory: this.stateHistory.slice(-10) // 只保存最近 10 条
    };
  }

  /**
   * 恢复状态（热更新后）
   */
  restoreState(savedState) {
    if (!savedState) return;

    console.log('[FSMService] Restoring state:', savedState);

    this.currentState = savedState.currentState || 'INIT';
    this.previousState = savedState.previousState || null;
    this.isPaused = savedState.isPaused || false;
    this.stateHistory = savedState.stateHistory || [];

    // 触发状态恢复事件
    this.emit('state-restored', this.currentState);
  }

  /**
   * 清理资源
   */
  cleanup() {
    console.log('[FSMService] Cleaning up...');

    // 移除 IPC 监听器
    this.ipcUnsubscribers.forEach(unsub => unsub());
    this.ipcUnsubscribers = [];

    // 移除所有事件监听器
    this.removeAllListeners();

    console.log('[FSMService] Cleanup complete');
  }
}

// 导出（浏览器环境，不使用 module.exports）
// 类会自动在全局作用域中可用
