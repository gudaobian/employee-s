/**
 * WMI-based Windows Activity Inferrer
 * 基于WMI查询的Windows用户活动推断器 - 无需特殊权限
 */

import * as os from 'os';
import { execSync } from 'child_process';
import { logger } from '../../../common/utils/logger';

export interface InferredActivityData {
  keystrokes: number;
  mouseClicks: number;
  idleTime: number;
  activeWindow: string;
  timestamp: Date;
  confidence: number; // 推断置信度 0-100%
  method: 'wmi-inference' | 'basic-apis' | 'hybrid';
}

export interface SystemActivityIndicators {
  windowFocusChanges: number;
  processActiveTime: number;
  systemIdleTime: number;
  inputLanguageChanges: number;
  cursorPositionVariation: number;
}

export class WMIActivityInferrer {
  private lastMeasurement: Date = new Date();
  private previousIndicators: SystemActivityIndicators | null = null;
  private confidenceFactors = {
    windowFocus: 0.7,
    processActivity: 0.6,
    systemIdle: 0.9,
    inputMethod: 0.5,
    cursorMovement: 0.4
  };

  constructor() {
    logger.info('[WMI-INFERRER] 初始化基于WMI的活动推断器');
  }

  /**
   * 检查WMI推断器是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      // 测试基本的WMI查询
      await this.executeWMIQuery('SELECT Name FROM Win32_Process WHERE ProcessId = $$');
      return true;
    } catch (error) {
      logger.error('[WMI-INFERRER] WMI查询不可用:', error);
      return false;
    }
  }

  /**
   * 执行WMI查询
   */
  private async executeWMIQuery(query: string): Promise<string> {
    try {
      const command = `powershell -Command "Get-WmiObject -Query '${query}' | ConvertTo-Json"`;
      const result = execSync(command, { 
        encoding: 'utf8', 
        timeout: 5000,
        windowsHide: true 
      });
      return result.trim();
    } catch (error) {
      throw new Error(`WMI查询失败: ${error.message}`);
    }
  }

  /**
   * 获取系统活动指标
   */
  async getSystemActivityIndicators(): Promise<SystemActivityIndicators> {
    const indicators: SystemActivityIndicators = {
      windowFocusChanges: 0,
      processActiveTime: 0,
      systemIdleTime: 0,
      inputLanguageChanges: 0,
      cursorPositionVariation: 0
    };

    try {
      // 1. 获取活动窗口信息
      indicators.windowFocusChanges = await this.getWindowFocusActivity();
      
      // 2. 获取进程活动时间
      indicators.processActiveTime = await this.getProcessActivity();
      
      // 3. 获取系统空闲时间
      indicators.systemIdleTime = await this.getSystemIdleTime();
      
      // 4. 检测输入法变化
      indicators.inputLanguageChanges = await this.getInputLanguageActivity();
      
      // 5. 分析光标位置变化
      indicators.cursorPositionVariation = await this.getCursorActivity();

    } catch (error) {
      logger.error('[WMI-INFERRER] 获取系统指标失败:', error);
    }

    return indicators;
  }

  /**
   * 分析窗口焦点变化活动
   */
  private async getWindowFocusActivity(): Promise<number> {
    try {
      // 获取当前活动窗口
      const query = `
        Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | 
        Select-Object ProcessName, MainWindowTitle, StartTime, CPU | 
        Sort-Object CPU -Descending | Select-Object -First 10
      `;
      
      const result = await this.executeWMIQuery(query);
      const processes = JSON.parse(result || '[]');
      
      // 基于进程CPU使用情况推断焦点变化
      let focusActivity = 0;
      if (Array.isArray(processes)) {
        processes.forEach((proc: any) => {
          if (proc.CPU > 0 && proc.MainWindowTitle) {
            focusActivity += Math.min(proc.CPU / 100, 1);
          }
        });
      }
      
      return Math.round(focusActivity * 10); // 转换为合理的焦点变化次数
    } catch (error) {
      logger.debug('[WMI-INFERRER] 窗口焦点分析失败:', error);
      return 0;
    }
  }

  /**
   * 获取进程活动信息
   */
  private async getProcessActivity(): Promise<number> {
    try {
      // 获取用户进程的CPU和内存使用情况
      const query = `
        Get-Process | Where-Object {
          $_.ProcessName -match "(chrome|firefox|notepad|winword|excel|outlook|code|idea)" -and
          $_.CPU -gt 0
        } | Measure-Object CPU -Sum
      `;
      
      const result = await this.executeWMIQuery(query);
      const cpuData = JSON.parse(result || '{"Sum": 0}');
      
      return Math.round(cpuData.Sum || 0);
    } catch (error) {
      logger.debug('[WMI-INFERRER] 进程活动分析失败:', error);
      return 0;
    }
  }

  /**
   * 获取系统空闲时间 (使用GetLastInputInfo)
   */
  private async getSystemIdleTime(): Promise<number> {
    try {
      // PowerShell调用Win32 API获取最后输入时间
      const query = `
        Add-Type @'
        using System;
        using System.Diagnostics;
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
      
      const result = await this.executeWMIQuery(query);
      return parseInt(result) || 0;
    } catch (error) {
      logger.debug('[WMI-INFERRER] 系统空闲时间获取失败:', error);
      // 备用方法：基于系统负载推断
      return this.inferIdleFromSystemLoad();
    }
  }

  /**
   * 检测输入法/键盘布局变化
   */
  private async getInputLanguageActivity(): Promise<number> {
    try {
      // 检测当前输入法状态
      const query = 'Get-WinUserLanguageList | Select-Object LanguageTag, InputMethodTip';
      const result = await this.executeWMIQuery(query);
      
      // 简单的输入法变化检测逻辑
      // 在实际实现中，需要维护历史状态进行比较
      return result.length > 50 ? 2 : 0; // 启发式判断
    } catch (error) {
      logger.debug('[WMI-INFERRER] 输入法检测失败:', error);
      return 0;
    }
  }

  /**
   * 分析光标位置变化
   */
  private async getCursorActivity(): Promise<number> {
    try {
      // 使用PowerShell获取光标位置
      const query = `
        Add-Type -AssemblyName System.Windows.Forms;
        $pos = [System.Windows.Forms.Cursor]::Position;
        @{X=$pos.X; Y=$pos.Y} | ConvertTo-Json
      `;
      
      const result = await this.executeWMIQuery(query);
      const position = JSON.parse(result);
      
      // 在实际实现中，需要跟踪位置变化历史
      // 这里返回基于当前位置的启发式值
      const variation = Math.abs(position.X % 100) + Math.abs(position.Y % 100);
      return Math.round(variation / 10);
    } catch (error) {
      logger.debug('[WMI-INFERRER] 光标位置分析失败:', error);
      return 0;
    }
  }

  /**
   * 基于系统负载推断空闲时间
   */
  private inferIdleFromSystemLoad(): number {
    try {
      const cpuUsage = os.loadavg()[0];
      const freeMemRatio = os.freemem() / os.totalmem();
      
      // 启发式推断：低CPU使用率 + 高可用内存 = 可能空闲
      if (cpuUsage < 0.1 && freeMemRatio > 0.7) {
        return 30000; // 假设空闲30秒
      } else if (cpuUsage < 0.3 && freeMemRatio > 0.5) {
        return 10000; // 假设空闲10秒
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 推断键盘活动
   */
  inferKeystrokes(indicators: SystemActivityIndicators, timeDelta: number): number {
    const weights = {
      windowFocus: 2.5,    // 窗口切换通常伴随键盘输入
      processActivity: 1.8, // 进程活动反映用户交互
      inputLanguage: 5.0,   // 输入法变化直接反映键盘使用
      lowIdle: 1.2         // 低空闲时间意味着活跃使用
    };

    let estimatedKeystrokes = 0;
    
    // 基于窗口焦点变化
    estimatedKeystrokes += indicators.windowFocusChanges * weights.windowFocus;
    
    // 基于进程活动
    const normalizedProcessActivity = Math.min(indicators.processActiveTime / 100, 10);
    estimatedKeystrokes += normalizedProcessActivity * weights.processActivity;
    
    // 基于输入法变化
    estimatedKeystrokes += indicators.inputLanguageChanges * weights.inputLanguage;
    
    // 基于空闲时间逆向推断
    if (indicators.systemIdleTime < 5000) { // 5秒内有输入
      estimatedKeystrokes += (5000 - indicators.systemIdleTime) / 1000 * weights.lowIdle;
    }
    
    // 时间归一化
    const timeInMinutes = timeDelta / 60000;
    estimatedKeystrokes = estimatedKeystrokes * Math.min(timeInMinutes, 1);
    
    return Math.round(Math.max(0, estimatedKeystrokes));
  }

  /**
   * 推断鼠标点击活动
   */
  inferMouseClicks(indicators: SystemActivityIndicators, timeDelta: number): number {
    const weights = {
      windowFocus: 1.5,     // 窗口切换可能涉及点击
      cursorMovement: 3.0,  // 光标移动与点击相关
      processActivity: 1.0  // 进程活动可能包含点击
    };

    let estimatedClicks = 0;
    
    // 基于窗口焦点变化（可能是Alt+Tab或点击）
    estimatedClicks += indicators.windowFocusChanges * weights.windowFocus;
    
    // 基于光标位置变化
    estimatedClicks += indicators.cursorPositionVariation * weights.cursorMovement;
    
    // 基于进程活动
    const normalizedProcessActivity = Math.min(indicators.processActiveTime / 200, 5);
    estimatedClicks += normalizedProcessActivity * weights.processActivity;
    
    // 时间归一化
    const timeInMinutes = timeDelta / 60000;
    estimatedClicks = estimatedClicks * Math.min(timeInMinutes, 1);
    
    return Math.round(Math.max(0, estimatedClicks));
  }

  /**
   * 计算推断置信度
   */
  calculateConfidence(indicators: SystemActivityIndicators): number {
    let confidence = 0;
    let totalWeight = 0;

    // 各指标的可信度权重
    const reliabilityWeights = {
      systemIdle: { weight: 0.9, value: indicators.systemIdleTime > 0 ? 1 : 0 },
      windowFocus: { weight: 0.7, value: indicators.windowFocusChanges > 0 ? 1 : 0 },
      processActivity: { weight: 0.6, value: indicators.processActiveTime > 0 ? 1 : 0 },
      cursorMovement: { weight: 0.4, value: indicators.cursorPositionVariation > 0 ? 1 : 0 },
      inputLanguage: { weight: 0.5, value: indicators.inputLanguageChanges > 0 ? 1 : 0 }
    };

    Object.values(reliabilityWeights).forEach(metric => {
      confidence += metric.weight * metric.value;
      totalWeight += metric.weight;
    });

    return Math.round((confidence / totalWeight) * 100);
  }

  /**
   * 获取推断的活动数据
   */
  async getInferredActivityData(): Promise<InferredActivityData> {
    const currentTime = new Date();
    const timeDelta = currentTime.getTime() - this.lastMeasurement.getTime();
    
    try {
      // 获取系统活动指标
      const indicators = await this.getSystemActivityIndicators();
      
      // 推断用户活动
      const keystrokes = this.inferKeystrokes(indicators, timeDelta);
      const mouseClicks = this.inferMouseClicks(indicators, timeDelta);
      
      // 计算置信度
      const confidence = this.calculateConfidence(indicators);
      
      // 获取活动窗口
      const activeWindow = await this.getActiveWindowTitle();
      
      this.lastMeasurement = currentTime;
      this.previousIndicators = indicators;
      
      const result: InferredActivityData = {
        keystrokes,
        mouseClicks,
        idleTime: indicators.systemIdleTime,
        activeWindow,
        timestamp: currentTime,
        confidence,
        method: 'wmi-inference'
      };

      logger.debug('[WMI-INFERRER] 推断结果:', {
        keystrokes,
        mouseClicks,
        confidence: `${confidence}%`,
        method: 'wmi-inference'
      });

      return result;
    } catch (error) {
      logger.error('[WMI-INFERRER] 活动推断失败:', error);
      
      // 返回最低置信度的基础数据
      return {
        keystrokes: 0,
        mouseClicks: 0,
        idleTime: 300000, // 5分钟
        activeWindow: 'Unknown',
        timestamp: currentTime,
        confidence: 10,
        method: 'basic-apis'
      };
    }
  }

  /**
   * 获取活动窗口标题
   */
  private async getActiveWindowTitle(): Promise<string> {
    try {
      const query = `
        Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | 
        Sort-Object CPU -Descending | 
        Select-Object -First 1 MainWindowTitle
      `;
      
      const result = await this.executeWMIQuery(query);
      const process = JSON.parse(result);
      
      return process?.MainWindowTitle || 'Unknown Window';
    } catch (error) {
      return 'Unknown Window';
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    logger.info('[WMI-INFERRER] 清理WMI活动推断器资源');
    this.previousIndicators = null;
  }
}

export default WMIActivityInferrer;