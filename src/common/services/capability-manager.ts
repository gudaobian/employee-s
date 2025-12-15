/**
 * System Capability Manager
 * 智能权限层次管理系统 - 渐进式权限策略
 */

import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface PermissionLevel {
  level: 'basic' | 'standard' | 'elevated';
  capabilities: string[];
  methods: string[];
  estimatedAccuracy: number;
  description: string;
}

export interface SystemCapabilities {
  currentLevel: PermissionLevel;
  availableLevels: PermissionLevel[];
  realTimeMonitoring: boolean;
  preciseInputTracking: boolean;
  estimatedAccuracy: number;
  activeFeatures: string[];
  limitedFeatures: string[];
  unavailableFeatures: string[];
  upgradeOptions: UpgradeOption[];
}

export interface UpgradeOption {
  targetLevel: string;
  requirements: string[];
  steps: string[];
  benefits: string[];
  risks: string[];
}

export interface CapabilityTestResult {
  feature: string;
  available: boolean;
  confidence: number;
  method: string;
  error?: string;
  performanceImpact: 'low' | 'medium' | 'high';
}

export class CapabilityManager extends EventEmitter {
  private static instance: CapabilityManager;
  private currentCapabilities: SystemCapabilities | null = null;
  private assessmentCache = new Map<string, CapabilityTestResult>();
  private lastAssessment: Date | null = null;
  private assessmentInterval = 60000; // 1分钟重新评估

  // 预定义的权限层次
  private readonly PERMISSION_LEVELS: Record<string, PermissionLevel> = {
    basic: {
      level: 'basic',
      capabilities: [
        'window-tracking',
        'process-monitoring', 
        'basic-idle-detection',
        'wmi-queries',
        'system-info'
      ],
      methods: [
        'WMI查询',
        'Win32 API (基础)',
        'Process API',
        'GetLastInputInfo',
        '窗口枚举'
      ],
      estimatedAccuracy: 65,
      description: '基础监控 - 无需特殊权限，基于系统API和WMI推断'
    },
    standard: {
      level: 'standard',
      capabilities: [
        'window-tracking',
        'process-monitoring',
        'basic-idle-detection',
        'wmi-queries',
        'system-info',
        'user-level-hooks',
        'input-method-tracking',
        'cursor-position'
      ],
      methods: [
        'WMI查询',
        'Win32 API (扩展)',
        'Process API',
        'GetLastInputInfo',
        '窗口枚举',
        '用户级Hook',
        '输入法监控'
      ],
      estimatedAccuracy: 80,
      description: '标准监控 - 用户级权限，部分Hook功能可用'
    },
    elevated: {
      level: 'elevated',
      capabilities: [
        'window-tracking',
        'process-monitoring',
        'basic-idle-detection',
        'wmi-queries',
        'system-info',
        'user-level-hooks',
        'input-method-tracking',
        'cursor-position',
        'system-level-hooks',
        'keyboard-monitoring',
        'mouse-monitoring',
        'application-monitoring'
      ],
      methods: [
        'WMI查询',
        'Win32 API (完整)',
        'Process API',
        'GetLastInputInfo',
        '窗口枚举',
        '用户级Hook',
        '输入法监控',
        '系统级Hook (WH_KEYBOARD_LL)',
        '系统级Hook (WH_MOUSE_LL)',
        '应用程序监控'
      ],
      estimatedAccuracy: 95,
      description: '完整监控 - 管理员权限，所有监控功能可用'
    }
  };

  private constructor() {
    super();
    logger.info('[CAPABILITY-MANAGER] 初始化系统能力管理器');
  }

  public static getInstance(): CapabilityManager {
    if (!CapabilityManager.instance) {
      CapabilityManager.instance = new CapabilityManager();
    }
    return CapabilityManager.instance;
  }

  /**
   * 评估系统能力
   */
  async assessCapabilities(): Promise<SystemCapabilities> {
    logger.info('[CAPABILITY-MANAGER] 开始系统能力评估');
    
    try {
      // 检查缓存
      if (this.currentCapabilities && this.isCacheValid()) {
        return this.currentCapabilities;
      }

      // 测试各项能力
      const testResults = await this.runCapabilityTests();
      
      // 确定当前权限级别
      const currentLevel = this.determinePermissionLevel(testResults);
      
      // 分析功能可用性
      const featureAnalysis = this.analyzeFeatureAvailability(testResults, currentLevel);
      
      // 生成升级选项
      const upgradeOptions = this.generateUpgradeOptions(currentLevel);
      
      this.currentCapabilities = {
        currentLevel,
        availableLevels: Object.values(this.PERMISSION_LEVELS),
        realTimeMonitoring: currentLevel.level !== 'basic',
        preciseInputTracking: currentLevel.level === 'elevated',
        estimatedAccuracy: currentLevel.estimatedAccuracy,
        ...featureAnalysis,
        upgradeOptions
      };

      this.lastAssessment = new Date();
      
      // 发出能力变化事件
      this.emit('capabilities-assessed', this.currentCapabilities);
      
      logger.info(`[CAPABILITY-MANAGER] 系统能力评估完成 - 当前级别: ${currentLevel.level} (${currentLevel.estimatedAccuracy}% 准确度)`);
      
      return this.currentCapabilities;
    } catch (error) {
      logger.error('[CAPABILITY-MANAGER] 系统能力评估失败:', error);
      
      // 返回最基础的能力配置
      return this.getFallbackCapabilities();
    }
  }

  /**
   * 运行能力测试套件
   */
  private async runCapabilityTests(): Promise<CapabilityTestResult[]> {
    const tests = [
      this.testWMIAccess(),
      this.testProcessAPI(),
      this.testWindowEnumeration(),
      this.testBasicIdleDetection(),
      this.testUserLevelHooks(),
      this.testSystemLevelHooks(),
      this.testInputMethodAccess(),
      this.testCursorPositionAccess()
    ];

    const results = await Promise.allSettled(tests);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const testNames = [
          'wmi-access', 'process-api', 'window-enumeration', 
          'basic-idle-detection', 'user-level-hooks', 
          'system-level-hooks', 'input-method-access', 'cursor-position-access'
        ];
        
        return {
          feature: testNames[index] || 'unknown',
          available: false,
          confidence: 0,
          method: 'test-failed',
          error: result.reason?.message || 'Unknown error',
          performanceImpact: 'low' as const
        };
      }
    });
  }

  /**
   * 测试WMI访问
   */
  private async testWMIAccess(): Promise<CapabilityTestResult> {
    try {
      const { execSync } = require('child_process');
      const result = execSync('powershell -Command "Get-WmiObject -Class Win32_Process | Select-Object -First 1 Name"', {
        timeout: 3000,
        windowsHide: true
      });
      
      return {
        feature: 'wmi-access',
        available: true,
        confidence: 90,
        method: 'wmi-query',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'wmi-access',
        available: false,
        confidence: 0,
        method: 'wmi-query',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 测试进程API访问
   */
  private async testProcessAPI(): Promise<CapabilityTestResult> {
    try {
      const { execSync } = require('child_process');
      execSync('tasklist /fo csv | findstr /i "explorer"', { timeout: 2000 });
      
      return {
        feature: 'process-api',
        available: true,
        confidence: 95,
        method: 'win32-api',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'process-api',
        available: false,
        confidence: 0,
        method: 'win32-api',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 测试窗口枚举
   */
  private async testWindowEnumeration(): Promise<CapabilityTestResult> {
    try {
      const { execSync } = require('child_process');
      const result = execSync('powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \\"\\"}  | Select-Object -First 3 MainWindowTitle"', {
        timeout: 3000,
        windowsHide: true
      });
      
      return {
        feature: 'window-enumeration',
        available: result.toString().trim().length > 0,
        confidence: 85,
        method: 'process-api',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'window-enumeration',
        available: false,
        confidence: 0,
        method: 'process-api',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 测试基础空闲检测
   */
  private async testBasicIdleDetection(): Promise<CapabilityTestResult> {
    try {
      // 测试GetLastInputInfo API访问
      const { execSync } = require('child_process');
      const script = `
        Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        public class IdleTime {
          [DllImport("user32.dll")]
          public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
          public struct LASTINPUTINFO {
            public uint cbSize;
            public uint dwTime;
          }
          public static uint GetLastInputTime() {
            LASTINPUTINFO lastInputInfo = new LASTINPUTINFO();
            lastInputInfo.cbSize = (uint)Marshal.SizeOf(lastInputInfo);
            GetLastInputInfo(ref lastInputInfo);
            return ((uint)Environment.TickCount - lastInputInfo.dwTime);
          }
        }
'@;
        [IdleTime]::GetLastInputTime()
      `;
      
      const result = execSync(`powershell -Command "${script}"`, {
        timeout: 5000,
        windowsHide: true
      });
      
      const idleTime = parseInt(result.toString().trim());
      
      return {
        feature: 'basic-idle-detection',
        available: !isNaN(idleTime) && idleTime >= 0,
        confidence: 95,
        method: 'getlastinputinfo',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'basic-idle-detection',
        available: false,
        confidence: 0,
        method: 'getlastinputinfo',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 测试用户级Hook
   */
  private async testUserLevelHooks(): Promise<CapabilityTestResult> {
    // 在实际实现中，这里会测试SetWindowsHookEx with WH_GETMESSAGE
    // 目前返回基于权限的推断结果
    try {
      const isElevated = await this.checkElevatedPrivileges();
      
      return {
        feature: 'user-level-hooks',
        available: true, // 用户级Hook通常可用
        confidence: isElevated ? 90 : 70,
        method: 'setwindowshookex',
        performanceImpact: 'medium'
      };
    } catch (error) {
      return {
        feature: 'user-level-hooks',
        available: false,
        confidence: 0,
        method: 'setwindowshookex',
        error: error.message,
        performanceImpact: 'medium'
      };
    }
  }

  /**
   * 测试系统级Hook
   */
  private async testSystemLevelHooks(): Promise<CapabilityTestResult> {
    try {
      const isElevated = await this.checkElevatedPrivileges();
      const isAdminProcess = await this.checkAdminProcess();
      
      if (!isElevated && !isAdminProcess) {
        return {
          feature: 'system-level-hooks',
          available: false,
          confidence: 0,
          method: 'low-level-hooks',
          error: 'Requires elevated privileges',
          performanceImpact: 'high'
        };
      }
      
      // 在实际实现中，这里会测试WH_KEYBOARD_LL和WH_MOUSE_LL
      return {
        feature: 'system-level-hooks',
        available: isElevated,
        confidence: isElevated ? 95 : 20,
        method: 'low-level-hooks',
        performanceImpact: 'high'
      };
    } catch (error) {
      return {
        feature: 'system-level-hooks',
        available: false,
        confidence: 0,
        method: 'low-level-hooks',
        error: error.message,
        performanceImpact: 'high'
      };
    }
  }

  /**
   * 测试输入法访问
   */
  private async testInputMethodAccess(): Promise<CapabilityTestResult> {
    try {
      const { execSync } = require('child_process');
      const result = execSync('powershell -Command "Get-WinUserLanguageList | Select-Object -First 1 LanguageTag"', {
        timeout: 3000,
        windowsHide: true
      });
      
      return {
        feature: 'input-method-access',
        available: result.toString().trim().length > 0,
        confidence: 80,
        method: 'powershell-api',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'input-method-access',
        available: false,
        confidence: 0,
        method: 'powershell-api',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 测试光标位置访问
   */
  private async testCursorPositionAccess(): Promise<CapabilityTestResult> {
    try {
      const { execSync } = require('child_process');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        $pos = [System.Windows.Forms.Cursor]::Position;
        "$($pos.X),$($pos.Y)"
      `;
      
      const result = execSync(`powershell -Command "${script}"`, {
        timeout: 3000,
        windowsHide: true
      });
      
      const coords = result.toString().trim().split(',');
      
      return {
        feature: 'cursor-position-access',
        available: coords.length === 2 && !isNaN(parseInt(coords[0])),
        confidence: 90,
        method: 'winforms-api',
        performanceImpact: 'low'
      };
    } catch (error) {
      return {
        feature: 'cursor-position-access',
        available: false,
        confidence: 0,
        method: 'winforms-api',
        error: error.message,
        performanceImpact: 'low'
      };
    }
  }

  /**
   * 检查是否有提升的权限
   */
  private async checkElevatedPrivileges(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      const result = execSync('powershell -Command "[Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains \'S-1-5-32-544\'"', {
        timeout: 2000,
        windowsHide: true
      });
      
      return result.toString().trim().toLowerCase() === 'true';
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查是否以管理员身份运行
   */
  private async checkAdminProcess(): Promise<boolean> {
    try {
      const { execSync } = require('child_process');
      execSync('net session', { timeout: 2000, stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 确定权限级别
   */
  private determinePermissionLevel(testResults: CapabilityTestResult[]): PermissionLevel {
    const availableFeatures = testResults.filter(r => r.available).map(r => r.feature);
    
    // 检查是否有系统级Hook能力
    if (availableFeatures.includes('system-level-hooks')) {
      return this.PERMISSION_LEVELS.elevated;
    }
    
    // 检查是否有用户级Hook能力
    if (availableFeatures.includes('user-level-hooks') && 
        availableFeatures.includes('input-method-access')) {
      return this.PERMISSION_LEVELS.standard;
    }
    
    // 基础级别
    return this.PERMISSION_LEVELS.basic;
  }

  /**
   * 分析功能可用性
   */
  private analyzeFeatureAvailability(testResults: CapabilityTestResult[], currentLevel: PermissionLevel) {
    const availableFeatures: string[] = [];
    const limitedFeatures: string[] = [];
    const unavailableFeatures: string[] = [];

    testResults.forEach(result => {
      if (result.available && result.confidence > 70) {
        availableFeatures.push(result.feature);
      } else if (result.available && result.confidence > 30) {
        limitedFeatures.push(result.feature);
      } else {
        unavailableFeatures.push(result.feature);
      }
    });

    return {
      activeFeatures: availableFeatures,
      limitedFeatures,
      unavailableFeatures
    };
  }

  /**
   * 生成升级选项
   */
  private generateUpgradeOptions(currentLevel: PermissionLevel): UpgradeOption[] {
    const options: UpgradeOption[] = [];
    
    if (currentLevel.level === 'basic') {
      options.push({
        targetLevel: 'standard',
        requirements: ['用户级权限', '应用程序重启'],
        steps: [
          '1. 右键点击应用程序',
          '2. 选择"以管理员身份运行"',
          '3. 重启监控服务'
        ],
        benefits: [
          '提升监控准确度至80%',
          '启用用户级事件Hook',
          '改进输入法检测'
        ],
        risks: ['可能触发UAC提示']
      });
      
      options.push({
        targetLevel: 'elevated',
        requirements: ['管理员权限', 'IT支持'],
        steps: [
          '1. 联系IT管理员',
          '2. 请求安装具有管理员权限的版本',
          '3. 配置企业安全策略例外'
        ],
        benefits: [
          '最高监控准确度(95%)',
          '完整键盘和鼠标监控',
          '实时事件检测'
        ],
        risks: [
          '需要IT审批',
          '可能影响企业安全策略',
          '需要防病毒软件配置'
        ]
      });
    }
    
    if (currentLevel.level === 'standard') {
      options.push({
        targetLevel: 'elevated',
        requirements: ['管理员权限', 'IT支持'],
        steps: [
          '1. 联系IT管理员',
          '2. 请求提升应用程序权限',
          '3. 配置系统级Hook权限'
        ],
        benefits: [
          '提升准确度至95%',
          '启用系统级监控',
          '消除监控延迟'
        ],
        risks: [
          '需要IT审批',
          '可能需要重新安装'
        ]
      });
    }

    return options;
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(): boolean {
    if (!this.lastAssessment) return false;
    
    const now = new Date();
    const elapsed = now.getTime() - this.lastAssessment.getTime();
    
    return elapsed < this.assessmentInterval;
  }

  /**
   * 获取备用能力配置
   */
  private getFallbackCapabilities(): SystemCapabilities {
    const basicLevel = this.PERMISSION_LEVELS.basic;
    
    return {
      currentLevel: basicLevel,
      availableLevels: Object.values(this.PERMISSION_LEVELS),
      realTimeMonitoring: false,
      preciseInputTracking: false,
      estimatedAccuracy: 50,
      activeFeatures: ['window-tracking'],
      limitedFeatures: ['process-monitoring'],
      unavailableFeatures: ['keyboard-monitoring', 'mouse-monitoring'],
      upgradeOptions: this.generateUpgradeOptions(basicLevel)
    };
  }

  /**
   * 获取当前能力
   */
  getCurrentCapabilities(): SystemCapabilities | null {
    return this.currentCapabilities;
  }

  /**
   * 强制重新评估
   */
  async forceReassessment(): Promise<SystemCapabilities> {
    this.lastAssessment = null;
    this.currentCapabilities = null;
    this.assessmentCache.clear();
    
    return await this.assessCapabilities();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.removeAllListeners();
    this.assessmentCache.clear();
    this.currentCapabilities = null;
    logger.info('[CAPABILITY-MANAGER] 系统能力管理器已清理');
  }
}

export default CapabilityManager;