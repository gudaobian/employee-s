/**
 * 教学模式检测服务
 *
 * 功能:
 * 1. 检测 ClassIn/Zoom/腾讯会议等教学/会议软件
 * 2. 自动切换到低干扰监控模式
 * 3. 通过事件通知各消费者调整行为
 *
 * 设计目标:
 * - 最小化对直播教学的干扰
 * - 避免 GC 阻塞、截图资源竞争
 * - 智能适配，无需用户手动配置
 */

import { EventEmitter } from 'events';
import { logger } from '../utils';

/**
 * 教学/会议应用列表 (跨平台)
 *
 * 匹配策略: 不区分大小写，支持部分匹配
 */
const TEACHING_APPS: { name: string; keywords: string[]; category: 'education' | 'meeting' | 'live' }[] = [
  // 在线教育平台
  { name: 'ClassIn',        keywords: ['classin'],                    category: 'education' },
  { name: '腾讯课堂',        keywords: ['tencentedu', 'ke.qq'],        category: 'education' },
  { name: '钉钉课堂',        keywords: ['dingtalk'],                   category: 'education' },
  { name: '雨课堂',          keywords: ['yuketang', 'rain classroom'], category: 'education' },
  { name: '学习通',          keywords: ['chaoxing', 'xuexitong'],      category: 'education' },
  { name: '希沃白板',        keywords: ['seewo', 'easinote'],          category: 'education' },
  { name: '学而思',          keywords: ['xueersi', 'tal'],             category: 'education' },
  { name: '作业帮',          keywords: ['zuoyebang'],                  category: 'education' },
  { name: '猿辅导',          keywords: ['yuanfudao'],                  category: 'education' },

  // 视频会议软件
  { name: 'Zoom',           keywords: ['zoom'],                       category: 'meeting' },
  { name: '腾讯会议',        keywords: ['wemeet', 'tencentmeeting'],   category: 'meeting' },
  { name: '飞书会议',        keywords: ['feishu', 'lark', 'bytedance'], category: 'meeting' },
  { name: '钉钉',            keywords: ['dingtalk', 'alidingtalk'],    category: 'meeting' },
  { name: 'Microsoft Teams', keywords: ['teams'],                     category: 'meeting' },
  { name: 'Webex',          keywords: ['webex', 'cisco'],             category: 'meeting' },
  { name: 'Google Meet',    keywords: ['meet.google'],                category: 'meeting' },
  { name: 'Skype',          keywords: ['skype'],                      category: 'meeting' },
  { name: 'WeLink',         keywords: ['welink', 'huawei'],           category: 'meeting' },
  { name: '小鱼易连',        keywords: ['xylink', 'xiaoyu'],           category: 'meeting' },

  // 直播软件
  { name: 'OBS Studio',     keywords: ['obs', 'obs64', 'obs studio'], category: 'live' },
  { name: '斗鱼直播',        keywords: ['douyu'],                      category: 'live' },
  { name: '虎牙直播',        keywords: ['huya'],                       category: 'live' },
  { name: 'Bilibili直播',   keywords: ['bilibili', 'bililive'],       category: 'live' },
  { name: '抖音直播',        keywords: ['douyin', 'aweme'],            category: 'live' },
  { name: '快手直播',        keywords: ['kuaishou', 'kwai'],           category: 'live' },
];

/**
 * 浏览器中的 Web 会议关键词 (匹配窗口标题)
 */
const WEB_MEETING_KEYWORDS = [
  // Zoom Web
  'zoom meeting', 'zoom webinar', 'zoom.us',
  // 腾讯会议 Web
  '腾讯会议', 'voov meeting', 'meeting.tencent',
  // Google Meet
  'google meet', 'meet.google.com',
  // Microsoft Teams Web
  'microsoft teams', 'teams.microsoft',
  // Webex Web
  'webex meeting', 'webex.com',
  // 其他
  '在线会议', '视频会议', 'video conference'
];

/**
 * 教学模式类型
 */
export type TeachingMode = 'normal' | 'teaching';

/**
 * 教学模式配置
 */
export interface TeachingModeConfig {
  // 检测配置
  checkInterval: number;           // 检测间隔 (ms)
  debounceDelay: number;           // 防抖延迟 (ms)

  // 教学模式下的监控配置
  screenshotInterval: number;      // 截图间隔 (ms)
  screenshotQuality: number;       // 截图质量 (1-100)
  screenshotMaxWidth: number;      // 截图最大宽度
  screenshotMaxHeight: number;     // 截图最大高度
  screenshotRandomDelay: number;   // 截图随机延迟上限 (ms)
  screenshotPriority: 'normal' | 'low'; // 截图进程优先级
  processScanInterval: number;     // 进程扫描间隔 (ms)
  enableGC: boolean;               // 是否允许主动 GC
  gcIdleThreshold: number;         // GC 空闲阈值 (ms)
}

/**
 * 教学模式状态
 */
export interface TeachingModeState {
  mode: TeachingMode;
  detectedApp: string | null;
  detectedCategory: 'education' | 'meeting' | 'live' | null;
  matchedBy: 'application' | 'title' | null;
  lastChangeTime: number;
  teachingDuration: number;        // 教学模式持续时间 (ms)
}

/**
 * 模式变更事件
 */
export interface ModeChangeEvent {
  oldMode: TeachingMode;
  newMode: TeachingMode;
  detectedApp: string | null;
  detectedCategory: 'education' | 'meeting' | 'live' | null;
  config: Partial<TeachingModeConfig>;
}

/**
 * 平台适配器接口 (最小依赖)
 */
interface IPlatformAdapterMinimal {
  getActiveWindow(): Promise<{ title: string; application: string; pid?: number } | null>;
  getIdleTime?(): Promise<number>;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: TeachingModeConfig = {
  // 检测配置
  checkInterval: 5000,             // 5秒检测一次
  debounceDelay: 3000,             // 3秒防抖

  // 教学模式监控配置 (低干扰)
  screenshotInterval: 900000,      // 15分钟
  screenshotQuality: 5,            // 5% 质量
  screenshotMaxWidth: 960,
  screenshotMaxHeight: 540,
  screenshotRandomDelay: 10000,    // 0-10秒随机延迟
  screenshotPriority: 'low',       // 低优先级
  processScanInterval: 900000,     // 15分钟
  enableGC: false,                 // 禁用主动 GC
  gcIdleThreshold: 60000           // 空闲60秒后才 GC
};

/**
 * 教学模式检测服务
 */
export class TeachingModeService extends EventEmitter {
  private platformAdapter: IPlatformAdapterMinimal;
  private config: TeachingModeConfig;
  private state: TeachingModeState;

  private checkTimer?: NodeJS.Timeout;
  private debounceTimer?: NodeJS.Timeout;
  private isRunning = false;

  // 用于防抖的临时状态
  private pendingMode: TeachingMode | null = null;
  private pendingApp: string | null = null;
  private pendingCategory: 'education' | 'meeting' | 'live' | null = null;
  private pendingMatchedBy: 'application' | 'title' | null = null;

  constructor(
    platformAdapter: IPlatformAdapterMinimal,
    config?: Partial<TeachingModeConfig>
  ) {
    super();
    this.platformAdapter = platformAdapter;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.state = {
      mode: 'normal',
      detectedApp: null,
      detectedCategory: null,
      matchedBy: null,
      lastChangeTime: Date.now(),
      teachingDuration: 0
    };
  }

  /**
   * 启动检测服务
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[TeachingMode] Service already running');
      return;
    }

    this.isRunning = true;
    logger.info('[TeachingMode] 🎓 Service started', {
      checkInterval: `${this.config.checkInterval}ms`,
      debounceDelay: `${this.config.debounceDelay}ms`
    });

    // 立即执行一次检测
    this.performCheck();

    // 启动定期检测
    this.checkTimer = setInterval(() => {
      this.performCheck();
    }, this.config.checkInterval);
  }

  /**
   * 停止检测服务
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    logger.info('[TeachingMode] Service stopped');
  }

  /**
   * 获取当前是否处于教学模式
   */
  isTeachingMode(): boolean {
    return this.state.mode === 'teaching';
  }

  /**
   * 获取当前状态
   */
  getState(): TeachingModeState {
    // 更新教学持续时间
    if (this.state.mode === 'teaching') {
      this.state.teachingDuration = Date.now() - this.state.lastChangeTime;
    }
    return { ...this.state };
  }

  /**
   * 获取当前生效的配置
   */
  getActiveConfig(): Partial<TeachingModeConfig> {
    if (this.state.mode === 'teaching') {
      return {
        screenshotInterval: this.config.screenshotInterval,
        screenshotQuality: this.config.screenshotQuality,
        screenshotMaxWidth: this.config.screenshotMaxWidth,
        screenshotMaxHeight: this.config.screenshotMaxHeight,
        screenshotRandomDelay: this.config.screenshotRandomDelay,
        screenshotPriority: this.config.screenshotPriority,
        processScanInterval: this.config.processScanInterval,
        enableGC: this.config.enableGC,
        gcIdleThreshold: this.config.gcIdleThreshold
      };
    }

    // 正常模式返回空对象，使用默认配置
    return {};
  }

  /**
   * 获取空闲时间
   */
  async getIdleTime(): Promise<number> {
    if (this.platformAdapter.getIdleTime) {
      return await this.platformAdapter.getIdleTime();
    }
    return 0;
  }

  /**
   * 检查是否应该允许 GC
   */
  async shouldAllowGC(): Promise<boolean> {
    if (this.state.mode === 'normal') {
      return true; // 正常模式允许 GC
    }

    // 教学模式下，只有空闲时才允许 GC
    const idleTime = await this.getIdleTime();
    return idleTime >= this.config.gcIdleThreshold;
  }

  /**
   * 执行检测
   */
  private async performCheck(): Promise<void> {
    try {
      const detection = await this.detectTeachingMode();

      const targetMode: TeachingMode = detection.isTeaching ? 'teaching' : 'normal';

      // 如果模式相同，无需处理
      if (targetMode === this.state.mode) {
        // 清除任何待处理的防抖
        this.pendingMode = null;
        return;
      }

      // 模式不同，启动防抖处理
      this.handleModeChangeWithDebounce(
        targetMode,
        detection.detectedApp,
        detection.detectedCategory,
        detection.matchedBy
      );

    } catch (error) {
      logger.warn('[TeachingMode] Check failed:', error);
    }
  }

  /**
   * 检测当前是否处于教学模式
   */
  private async detectTeachingMode(): Promise<{
    isTeaching: boolean;
    detectedApp: string | null;
    detectedCategory: 'education' | 'meeting' | 'live' | null;
    matchedBy: 'application' | 'title' | null;
  }> {
    try {
      const activeWindow = await this.platformAdapter.getActiveWindow();

      if (!activeWindow) {
        return { isTeaching: false, detectedApp: null, detectedCategory: null, matchedBy: null };
      }

      const appName = activeWindow.application?.toLowerCase() || '';
      const windowTitle = activeWindow.title?.toLowerCase() || '';

      // 策略1: 匹配应用程序名称
      for (const app of TEACHING_APPS) {
        for (const keyword of app.keywords) {
          if (appName.includes(keyword.toLowerCase())) {
            return {
              isTeaching: true,
              detectedApp: app.name,
              detectedCategory: app.category,
              matchedBy: 'application'
            };
          }
        }
      }

      // 策略2: 匹配窗口标题 (用于浏览器中的 Web 会议)
      for (const keyword of WEB_MEETING_KEYWORDS) {
        if (windowTitle.includes(keyword.toLowerCase())) {
          return {
            isTeaching: true,
            detectedApp: `Web: ${keyword}`,
            detectedCategory: 'meeting',
            matchedBy: 'title'
          };
        }
      }

      return { isTeaching: false, detectedApp: null, detectedCategory: null, matchedBy: null };

    } catch (error) {
      logger.warn('[TeachingMode] Detection error:', error);
      return { isTeaching: false, detectedApp: null, detectedCategory: null, matchedBy: null };
    }
  }

  /**
   * 带防抖的模式切换处理
   *
   * 防抖逻辑:
   * - 检测到模式变化后，等待 debounceDelay 时间
   * - 如果这段时间内模式又变回原来的，则不触发切换
   * - 避免用户快速切换窗口导致频繁模式变更
   */
  private handleModeChangeWithDebounce(
    newMode: TeachingMode,
    detectedApp: string | null,
    detectedCategory: 'education' | 'meeting' | 'live' | null,
    matchedBy: 'application' | 'title' | null
  ): void {
    // 保存待处理的状态
    this.pendingMode = newMode;
    this.pendingApp = detectedApp;
    this.pendingCategory = detectedCategory;
    this.pendingMatchedBy = matchedBy;

    // 清除之前的防抖定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的防抖定时器
    this.debounceTimer = setTimeout(() => {
      // 确认模式确实需要变更
      if (this.pendingMode && this.pendingMode !== this.state.mode) {
        this.applyModeChange(
          this.pendingMode,
          this.pendingApp,
          this.pendingCategory,
          this.pendingMatchedBy
        );
      }

      // 清除待处理状态
      this.pendingMode = null;
      this.pendingApp = null;
      this.pendingCategory = null;
      this.pendingMatchedBy = null;

    }, this.config.debounceDelay);
  }

  /**
   * 应用模式变更
   */
  private applyModeChange(
    newMode: TeachingMode,
    detectedApp: string | null,
    detectedCategory: 'education' | 'meeting' | 'live' | null,
    matchedBy: 'application' | 'title' | null
  ): void {
    const oldMode = this.state.mode;

    // 更新状态
    this.state = {
      mode: newMode,
      detectedApp,
      detectedCategory,
      matchedBy,
      lastChangeTime: Date.now(),
      teachingDuration: 0
    };

    logger.info(`[TeachingMode] 🔄 模式切换: ${oldMode} → ${newMode}`, {
      detectedApp,
      detectedCategory,
      matchedBy,
      timestamp: new Date().toISOString()
    });

    // 构建事件数据
    const event: ModeChangeEvent = {
      oldMode,
      newMode,
      detectedApp,
      detectedCategory,
      config: this.getActiveConfig()
    };

    // 发射通用事件
    this.emit('mode-changed', event);

    // 发射特定事件
    if (newMode === 'teaching') {
      logger.info('[TeachingMode] 🎓 进入教学模式', {
        app: detectedApp,
        category: detectedCategory,
        screenshotInterval: `${this.config.screenshotInterval / 60000}分钟`,
        processScanInterval: `${this.config.processScanInterval / 60000}分钟`,
        gcEnabled: this.config.enableGC
      });

      this.emit('teaching-mode-entered', {
        app: detectedApp,
        category: detectedCategory,
        config: this.getActiveConfig()
      });
    } else {
      const duration = Date.now() - this.state.lastChangeTime;
      logger.info('[TeachingMode] 📊 退出教学模式', {
        duration: `${Math.round(duration / 60000)}分钟`
      });

      this.emit('teaching-mode-exited', {
        duration,
        previousApp: detectedApp
      });
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<TeachingModeConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[TeachingMode] Config updated', newConfig);
  }

  /**
   * 手动设置模式 (用于测试或管理员控制)
   */
  setMode(mode: TeachingMode, reason?: string): void {
    if (mode === this.state.mode) {
      return;
    }

    logger.info(`[TeachingMode] 手动设置模式: ${mode}`, { reason });

    this.applyModeChange(
      mode,
      reason || 'Manual override',
      null,
      null
    );
  }

  /**
   * 获取支持的教学应用列表
   */
  static getSupportedApps(): { name: string; category: string }[] {
    return TEACHING_APPS.map(app => ({
      name: app.name,
      category: app.category
    }));
  }
}

// 导出单例工厂函数
let serviceInstance: TeachingModeService | null = null;

export function getTeachingModeService(
  platformAdapter?: IPlatformAdapterMinimal,
  config?: Partial<TeachingModeConfig>
): TeachingModeService | null {
  if (!serviceInstance && platformAdapter) {
    serviceInstance = new TeachingModeService(platformAdapter, config);
  }
  return serviceInstance;
}

export function resetTeachingModeService(): void {
  if (serviceInstance) {
    serviceInstance.stop();
    serviceInstance = null;
  }
}
