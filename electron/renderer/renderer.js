/**
 * 渲染进程主逻辑
 * 处理UI交互和与主进程的通信
 */

class EmployeeMonitorUI {
  constructor() {
    this.currentTab = 'dashboard';
    this.appStatus = 'unknown';
    this.config = null;
    this.statusRefreshInterval = null;
    
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupIPCListeners();
    this.setupNavigation();
    this.setupStatusBar();
    this.loadInitialData();
    
    // 启动定时任务
    this.startStatusRefresh();
    this.updateTime();
    setInterval(() => this.updateTime(), 1000);
  }

  setupEventListeners() {
    // 标题栏按钮
    document.getElementById('minimize-btn').addEventListener('click', () => {
      window.electronAPI.window.minimize();
    });

    document.getElementById('close-btn').addEventListener('click', () => {
      window.electronAPI.window.close();
    });

    // 仪表盘控制按钮
    document.getElementById('start-monitoring').addEventListener('click', () => {
      this.startMonitoring();
    });

    document.getElementById('stop-monitoring').addEventListener('click', () => {
      this.stopMonitoring();
    });

    // 快速操作按钮
    document.getElementById('take-screenshot').addEventListener('click', () => {
      this.takeScreenshot();
    });

    document.getElementById('sync-data').addEventListener('click', () => {
      this.syncData();
    });

    document.getElementById('restart-app').addEventListener('click', () => {
      this.restartApp();
    });

    // 监控控制按钮
    document.getElementById('start-monitoring-full').addEventListener('click', () => {
      this.startMonitoring();
    });

    document.getElementById('pause-monitoring').addEventListener('click', () => {
      this.pauseMonitoring();
    });

    document.getElementById('stop-monitoring-full').addEventListener('click', () => {
      this.stopMonitoring();
    });

    // 设置表单
    document.getElementById('save-settings').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('reset-settings').addEventListener('click', () => {
      this.resetSettings();
    });

    // 监控设置
    document.getElementById('enable-screenshots').addEventListener('change', (e) => {
      this.updateMonitoringSettings({ screenshots: e.target.checked });
    });

    document.getElementById('enable-activity').addEventListener('change', (e) => {
      this.updateMonitoringSettings({ activity: e.target.checked });
    });

    document.getElementById('monitoring-interval').addEventListener('change', (e) => {
      this.updateMonitoringSettings({ interval: parseInt(e.target.value) * 1000 });
    });

    // FSM控制按钮
    document.getElementById('refresh-state').addEventListener('click', () => {
      this.refreshFSMState();
    });

    document.getElementById('check-permissions').addEventListener('click', () => {
      this.checkSystemPermissions();
    });
  }

  setupIPCListeners() {
    // 监听应用状态变化
    window.electronAPI.on('app-status-changed', (data) => {
      this.updateAppStatus(data.status);
    });

    // 监听应用错误
    window.electronAPI.on('app-error', (data) => {
      this.showNotification('error', `应用错误: ${data.error}`);
    });

    // 监听设备状态变化
    window.electronAPI.on('device-state-changed', (data) => {
      this.updateDeviceState(data);
    });

    // 监听健康检查结果
    window.electronAPI.on('health-check', (data) => {
      this.updateHealthStatus(data);
    });

    // 监听FSM状态变化
    window.electronAPI.on('fsm-state-changed', (data) => {
      this.updateFSMState(data);
    });

    // 监听状态更新
    window.electronAPI.on('status-update', (data) => {
      this.updateDetailedStatus(data);
    });

    // 监听权限要求
    window.electronAPI.on('permission-required', (data) => {
      this.handlePermissionRequired(data);
    });

    // 监听显示特定标签页
    window.electronAPI.on('show-status-tab', () => {
      this.switchTab('status');
    });

    window.electronAPI.on('show-settings-tab', () => {
      this.switchTab('settings');
    });
  }

  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabId = item.dataset.tab;
        this.switchTab(tabId);
      });
    });
  }

  setupStatusBar() {
    // 初始化连接状态
    this.updateConnectionStatus('checking');
  }

  switchTab(tabId) {
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    // 切换内容页面
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    
    document.getElementById(`${tabId}-tab`).classList.add('active');

    this.currentTab = tabId;

    // 加载页面特定数据
    this.loadTabData(tabId);
  }

  async loadInitialData() {
    try {
      // 加载应用状态
      const statusResult = await window.electronAPI.app.getStatus();
      if (statusResult.success) {
        this.updateDetailedStatus(statusResult.data);
      }

      // 加载配置
      const configResult = await window.electronAPI.app.getConfig();
      if (configResult.success) {
        this.config = configResult.data;
        this.updateConfigUI(configResult.data);
      }

      this.updateConnectionStatus('connected');
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.updateConnectionStatus('disconnected');
    }
  }

  async loadTabData(tabId) {
    if (tabId === 'status') {
      await this.refreshStatus();
    }
  }

  async startMonitoring() {
    try {
      this.showNotification('info', '正在启动监控...');
      
      const result = await window.electronAPI.app.start();
      
      if (result.success) {
        this.showNotification('success', '监控已启动');
        this.updateAppStatus('running');
      } else {
        this.showNotification('error', `启动失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `启动监控失败: ${error.message}`);
    }
  }

  async stopMonitoring() {
    try {
      this.showNotification('info', '正在停止监控...');
      
      const result = await window.electronAPI.app.stop();
      
      if (result.success) {
        this.showNotification('success', '监控已停止');
        this.updateAppStatus('stopped');
      } else {
        this.showNotification('error', `停止失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `停止监控失败: ${error.message}`);
    }
  }

  async pauseMonitoring() {
    // 暂停功能需要在后端实现
    this.showNotification('info', '暂停功能开发中...');
  }

  async restartApp() {
    try {
      this.showNotification('info', '正在重启应用...');
      
      const result = await window.electronAPI.app.restart();
      
      if (result.success) {
        this.showNotification('success', '应用已重启');
      } else {
        this.showNotification('error', `重启失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `重启应用失败: ${error.message}`);
    }
  }

  async takeScreenshot() {
    try {
      this.showNotification('info', '正在截屏...');
      
      const result = await window.electronAPI.system.takeScreenshot();
      
      if (result.success) {
        this.showNotification('success', '截屏已保存');
      } else {
        this.showNotification('error', `截屏失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `截屏失败: ${error.message}`);
    }
  }

  async syncData() {
    try {
      this.showNotification('info', '正在同步数据...');
      
      const result = await window.electronAPI.system.syncData();
      
      if (result.success) {
        this.showNotification('success', '数据同步完成');
      } else {
        this.showNotification('error', `同步失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `数据同步失败: ${error.message}`);
    }
  }

  async saveSettings() {
    try {
      const newConfig = this.getConfigFromUI();
      
      const result = await window.electronAPI.app.updateConfig(newConfig);
      
      if (result.success) {
        this.config = { ...this.config, ...newConfig };
        this.showNotification('success', '设置已保存');
      } else {
        this.showNotification('error', `保存失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `保存设置失败: ${error.message}`);
    }
  }

  resetSettings() {
    if (confirm('确定要重置所有设置到默认值吗？')) {
      this.updateConfigUI({
        serverUrl: 'http://23.95.193.155:3000',
        deviceId: '',
        autoStart: false,
        logLevel: 'info',
        enableMonitoring: true,
        monitoringInterval: 30000
      });
      
      this.showNotification('info', '设置已重置，请点击保存以应用更改');
    }
  }

  async refreshStatus() {
    try {
      const result = await window.electronAPI.app.getStatus();
      if (result.success) {
        this.updateDetailedStatus(result.data);
      }
    } catch (error) {
      console.error('Failed to refresh status:', error);
    }
  }

  updateAppStatus(status) {
    this.appStatus = status;
    
    const statusIndicator = document.getElementById('app-status-indicator');
    const statusText = document.getElementById('app-status-text');
    const statusTime = document.getElementById('app-status-time');
    
    // 更新状态指示器
    statusIndicator.className = `status-indicator ${status}`;
    
    // 更新状态文本
    const statusTexts = {
      running: '运行中',
      stopped: '已停止',
      starting: '启动中...',
      stopping: '停止中...',
      error: '错误'
    };
    
    statusText.textContent = statusTexts[status] || '未知';
    statusTime.textContent = new Date().toLocaleString();

    // 更新按钮状态
    const startBtn = document.getElementById('start-monitoring');
    const stopBtn = document.getElementById('stop-monitoring');
    
    if (status === 'running') {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  updateDetailedStatus(statusData) {
    const detailedStatusEl = document.getElementById('app-detailed-status');
    const deviceInfoEl = document.getElementById('device-info');
    
    if (statusData) {
      // 更新应用状态
      detailedStatusEl.innerHTML = `
        <div class="status-row">
          <span class="status-label">应用状态:</span>
          <span class="status-value">${statusData.appState}</span>
        </div>
        <div class="status-row">
          <span class="status-label">设备状态:</span>
          <span class="status-value">${statusData.deviceState || 'N/A'}</span>
        </div>
        <div class="status-row">
          <span class="status-label">运行时间:</span>
          <span class="status-value">${Math.floor(statusData.uptime / 60)} 分钟</span>
        </div>
        <div class="status-row">
          <span class="status-label">最后活动:</span>
          <span class="status-value">${statusData.lastActivity ? new Date(statusData.lastActivity).toLocaleString() : 'N/A'}</span>
        </div>
      `;

      // 更新设备信息
      if (statusData.platformInfo) {
        deviceInfoEl.innerHTML = `
          <div class="status-row">
            <span class="status-label">平台:</span>
            <span class="status-value">${statusData.platformInfo.systemInfo?.platform || 'N/A'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">版本:</span>
            <span class="status-value">${statusData.platformInfo.systemInfo?.version || 'N/A'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">主机名:</span>
            <span class="status-value">${statusData.platformInfo.systemInfo?.hostname || 'N/A'}</span>
          </div>
          <div class="status-row">
            <span class="status-label">用户:</span>
            <span class="status-value">${statusData.platformInfo.systemInfo?.username || 'N/A'}</span>
          </div>
        `;
      }
    }
  }

  updateConfigUI(config) {
    if (!config) return;

    // 更新服务器配置
    const serverUrlEl = document.getElementById('server-url');
    if (serverUrlEl) serverUrlEl.value = config.serverUrl || '';

    const deviceIdEl = document.getElementById('device-id');
    if (deviceIdEl) deviceIdEl.value = config.deviceId || '自动生成';

    // 更新应用设置
    const autoStartEl = document.getElementById('auto-start');
    if (autoStartEl) autoStartEl.checked = config.autoStart || false;

    const logLevelEl = document.getElementById('log-level');
    if (logLevelEl) logLevelEl.value = config.logLevel || 'info';

    // 更新监控设置
    const enableScreenshotsEl = document.getElementById('enable-screenshots');
    if (enableScreenshotsEl) enableScreenshotsEl.checked = config.enableMonitoring !== false;

    const monitoringIntervalEl = document.getElementById('monitoring-interval');
    if (monitoringIntervalEl) monitoringIntervalEl.value = Math.floor((config.monitoringInterval || 30000) / 1000);
  }

  getConfigFromUI() {
    return {
      serverUrl: document.getElementById('server-url').value,
      autoStart: document.getElementById('auto-start').checked,
      logLevel: document.getElementById('log-level').value,
      enableMonitoring: document.getElementById('enable-screenshots').checked,
      monitoringInterval: parseInt(document.getElementById('monitoring-interval').value) * 1000
    };
  }

  updateMonitoringSettings(settings) {
    // 实时更新监控设置
    console.log('Updating monitoring settings:', settings);
    // 这里可以实现实时更新设置的逻辑
  }

  updateConnectionStatus(status) {
    const connectionStatusEl = document.getElementById('connection-status');
    const connectionTextEl = document.getElementById('connection-text');
    
    connectionStatusEl.className = `status-indicator-small ${status}`;
    
    const statusTexts = {
      connected: '已连接',
      disconnected: '连接断开',
      checking: '检查连接中...'
    };
    
    connectionTextEl.textContent = statusTexts[status] || '未知状态';
  }

  updateDeviceState(data) {
    console.log('Device state changed:', data);
    // 更新设备状态显示
  }

  updateFSMState(data) {
    console.log('FSM state changed:', data);
    const { state, data: stateData } = data;
    
    // 更新状态显示
    const stateIndicators = document.querySelectorAll('.fsm-state-indicator');
    stateIndicators.forEach(indicator => {
      indicator.textContent = this.getFSMStateDisplayName(state);
      indicator.className = `fsm-state-indicator state-${state.toLowerCase()}`;
    });

    // 根据状态更新UI
    this.handleFSMStateChange(state, stateData);
    
    // 更新仪表盘状态卡片
    this.updateFSMStatusCard(state, stateData);
  }

  getFSMStateDisplayName(state) {
    const stateNames = {
      'INIT': '初始化',
      'HEARTBEAT': '心跳检查',
      'REGISTER': '设备注册',
      'BIND_CHECK': '绑定检查',
      'WS_CHECK': 'WebSocket检查',
      'CONFIG_FETCH': '配置获取',
      'DATA_COLLECT': '数据收集',
      'UNBOUND': '未绑定',
      'DISCONNECT': '连接断开',
      'ERROR': '错误状态'
    };
    return stateNames[state] || state;
  }

  handleFSMStateChange(state, data) {
    switch (state) {
      case 'INIT':
        this.updateAppStatus('starting');
        break;
      case 'DATA_COLLECT':
        this.updateAppStatus('running');
        break;
      case 'ERROR':
        this.updateAppStatus('error');
        if (data && data.error) {
          this.showNotification('error', `状态错误: ${data.error}`);
        }
        break;
      case 'DISCONNECT':
        this.updateConnectionStatus('disconnected');
        break;
      case 'UNBOUND':
        this.showNotification('warning', '设备未绑定，请联系管理员');
        break;
    }
  }

  updateFSMStatusCard(state, data) {
    const statusCard = document.getElementById('app-status-card');
    if (statusCard) {
      const statusText = statusCard.querySelector('#app-status-text');
      const statusTime = statusCard.querySelector('#app-status-time');
      
      if (statusText) {
        statusText.textContent = this.getFSMStateDisplayName(state);
      }
      
      if (statusTime) {
        statusTime.textContent = new Date().toLocaleString();
      }
    }
  }

  async handlePermissionRequired(data) {
    const { permissions, platform } = data;
    
    if (platform === 'darwin') {
      // macOS权限处理
      const result = await this.showMacPermissionDialog(permissions);
      if (result.action === 'grant') {
        await this.requestPermissions(permissions);
      } else if (result.action === 'wizard') {
        await this.showPermissionWizard(permissions);
      }
    } else {
      // 其他平台
      this.showNotification('warning', '需要系统权限，请检查应用设置');
    }
  }

  async showMacPermissionDialog(permissions) {
    const permissionNames = {
      'screenRecording': '屏幕录制',
      'accessibility': '辅助功能',
      'inputMonitoring': '输入监控',
      'fullDiskAccess': '完全磁盘访问',
      'camera': '摄像头',
      'microphone': '麦克风'
    };

    const permissionList = permissions.map(p => permissionNames[p] || p).join(', ');
    
    const result = confirm(
      `Employee Monitor需要以下权限才能正常工作:\n\n${permissionList}\n\n` +
      '点击"确定"打开系统设置页面进行授权，点击"取消"使用权限设置向导。'
    );

    return { action: result ? 'grant' : 'wizard' };
  }

  async requestPermissions(permissions) {
    try {
      const result = await window.electronAPI.permission.request(permissions);
      if (result.success) {
        this.showNotification('success', '权限请求已发送，请在系统设置中授权');
        // 打开系统设置
        await window.electronAPI.system.openSystemPreferences();
      } else {
        this.showNotification('error', `权限请求失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `权限请求失败: ${error.message}`);
    }
  }

  async showPermissionWizard(permissions) {
    try {
      await window.electronAPI.permission.showWizard(permissions);
    } catch (error) {
      console.error('Failed to show permission wizard:', error);
      this.showNotification('error', '无法打开权限设置向导');
    }
  }

  async refreshFSMState() {
    try {
      const result = await window.electronAPI.fsm.getCurrentState();
      if (result.success) {
        this.updateFSMState({ state: result.data.state });
        this.showNotification('success', '状态已刷新');
      } else {
        this.showNotification('error', `获取状态失败: ${result.error}`);
      }
    } catch (error) {
      this.showNotification('error', `获取状态失败: ${error.message}`);
    }
  }

  async checkSystemPermissions() {
    try {
      const platformInfo = await window.electronAPI.system.getPlatformInfo();
      if (!platformInfo.success) {
        this.showNotification('error', '无法获取平台信息');
        return;
      }

      const permissions = ['screenRecording', 'accessibility', 'inputMonitoring'];
      if (platformInfo.data.platform === 'darwin') {
        const result = await window.electronAPI.permission.check(permissions);
        if (result.success) {
          this.displayPermissionStatus(result.data);
        } else {
          this.showNotification('error', `权限检查失败: ${result.error}`);
        }
      } else {
        this.showNotification('info', '权限检查功能暂时只支持macOS');
      }
    } catch (error) {
      this.showNotification('error', `权限检查失败: ${error.message}`);
    }
  }

  displayPermissionStatus(permissions) {
    // 显示权限状态的简单弹窗
    const permissionNames = {
      'screenRecording': '屏幕录制',
      'accessibility': '辅助功能',
      'inputMonitoring': '输入监控'
    };

    let statusMessage = '权限状态:\n\n';
    let allGranted = true;

    Object.entries(permissions).forEach(([permission, status]) => {
      const name = permissionNames[permission] || permission;
      const statusText = status === 'granted' ? '✅ 已授权' : '❌ 未授权';
      statusMessage += `${name}: ${statusText}\n`;
      if (status !== 'granted') allGranted = false;
    });

    if (allGranted) {
      statusMessage += '\n所有权限已正确配置！';
      this.showNotification('success', '所有权限已正确配置');
    } else {
      statusMessage += '\n请点击"检查权限"按钮或使用权限设置向导来配置权限。';
      this.showNotification('warning', '部分权限未配置');
    }

    alert(statusMessage);
  }

  updateHealthStatus(data) {
    const healthCheckEl = document.getElementById('health-check');
    
    if (healthCheckEl && data) {
      const healthItems = [];
      
      if (data.services) {
        healthItems.push(`服务状态: ${data.services.healthy ? '正常' : '异常'}`);
      }
      
      if (data.platform !== undefined) {
        healthItems.push(`平台适配: ${data.platform ? '正常' : '异常'}`);
      }
      
      if (data.stateMachine !== undefined) {
        healthItems.push(`状态机: ${data.stateMachine ? '正常' : '异常'}`);
      }
      
      healthItems.push(`检查时间: ${new Date(data.timestamp).toLocaleString()}`);
      
      healthCheckEl.innerHTML = healthItems.map(item => 
        `<div class="status-row"><span>${item}</span></div>`
      ).join('');
    }
  }

  startStatusRefresh() {
    this.statusRefreshInterval = setInterval(() => {
      if (this.currentTab === 'status') {
        this.refreshStatus();
      }
    }, 10000); // 每10秒刷新一次状态
  }

  updateTime() {
    const currentTimeEl = document.getElementById('current-time');
    if (currentTimeEl) {
      currentTimeEl.textContent = new Date().toLocaleString();
    }
  }

  showNotification(type, message, duration = 3000) {
    const notificationsEl = document.getElementById('notifications');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    notificationsEl.appendChild(notification);
    
    // 自动移除通知
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
  }
}

// 初始化UI
document.addEventListener('DOMContentLoaded', () => {
  window.ui = new EmployeeMonitorUI();
});

// 添加一些全局样式
const style = document.createElement('style');
style.textContent = `
  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f1f1f1;
  }
  
  .status-row:last-child {
    border-bottom: none;
  }
  
  .status-label {
    font-weight: 600;
    color: #2c3e50;
  }
  
  .status-value {
    color: #7f8c8d;
  }
`;
document.head.appendChild(style);