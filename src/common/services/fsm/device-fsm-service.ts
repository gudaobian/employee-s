/**
 * 设备FSM服务 - 重构版本
 * 基于新架构的有限状态机实现
 */

import { EventEmitter } from 'events';
import {
  IDeviceFSMService,
  IStateHandler,
  DeviceState,
  FSMContext,
  StateTransition,
  FSMConfiguration,
  FSMEvent
} from '../../interfaces/fsm-interfaces';
import { IConfigService, IWebSocketService } from '../../interfaces/service-interfaces';
import { IPlatformAdapter } from '../../interfaces/platform-interface';
import { StateHandlerFactory } from './state-handlers';

export class DeviceFSMService extends EventEmitter implements IDeviceFSMService {
  private currentState: DeviceState = DeviceState.INIT;
  private previousState?: DeviceState;
  private stateHandlers = new Map<DeviceState, IStateHandler>();
  private isRunning = false;
  private stateStartTime: Date = new Date();
  private transitionHistory: Array<{
    from: DeviceState;
    to: DeviceState;
    timestamp: Date;
    reason?: string;
    data?: any;
  }> = [];

  // FSM配置
  private config: FSMConfiguration = {
    initialState: DeviceState.INIT,
    maxRetries: 3,
    retryDelay: 1000,
    timeouts: {
      [DeviceState.INIT]: 30000,
      [DeviceState.HEARTBEAT]: 10000,
      [DeviceState.REGISTER]: 15000,
      [DeviceState.BIND_CHECK]: 10000,
      [DeviceState.WS_CHECK]: 5000,
      [DeviceState.CONFIG_FETCH]: 10000,
      [DeviceState.DATA_COLLECT]: 0, // 无超时，持续运行
      [DeviceState.UNBOUND]: 5000,
      [DeviceState.DISCONNECT]: 5000,
      [DeviceState.ERROR]: 30000
    },
    transitions: {
      [DeviceState.INIT]: [DeviceState.HEARTBEAT, DeviceState.ERROR],
      [DeviceState.HEARTBEAT]: [DeviceState.REGISTER, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.REGISTER]: [DeviceState.BIND_CHECK, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.BIND_CHECK]: [DeviceState.WS_CHECK, DeviceState.UNBOUND, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.WS_CHECK]: [DeviceState.CONFIG_FETCH, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.CONFIG_FETCH]: [DeviceState.DATA_COLLECT, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.DATA_COLLECT]: [DeviceState.UNBOUND, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.UNBOUND]: [DeviceState.BIND_CHECK, DeviceState.DISCONNECT, DeviceState.ERROR],
      [DeviceState.DISCONNECT]: [DeviceState.HEARTBEAT, DeviceState.ERROR],
      [DeviceState.ERROR]: [DeviceState.INIT, DeviceState.HEARTBEAT, DeviceState.UNBOUND, DeviceState.DISCONNECT]
    }
  };

  private stateTimeouts = new Map<DeviceState, NodeJS.Timeout>();
  private attemptCount = 0;
  private stateHandlerFactory?: StateHandlerFactory;

  constructor(
    configService?: IConfigService,
    platformAdapter?: IPlatformAdapter,
    appInstance?: EventEmitter,
    activityCollectorService?: any,
    websocketService?: IWebSocketService
  ) {
    super();
    this.setMaxListeners(20);

    // 初始化状态处理器工厂
    if (configService && platformAdapter) {
      this.stateHandlerFactory = new StateHandlerFactory(
        configService,
        platformAdapter,
        appInstance,
        activityCollectorService,
        websocketService
      );
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[FSM] Service is already running');
      return;
    }

    try {
      this.isRunning = true;
      this.currentState = this.config.initialState;
      this.stateStartTime = new Date();

      // 先初始化状态处理器
      if (!this.initializeStateHandlers()) {
        throw new Error('Failed to initialize state handlers');
      }
      
      console.log(`[FSM] Starting FSM service with initial state: ${this.currentState}`);
      
      this.emit('fsm-started');
      this.emitFSMEvent('fsm-started', { initialState: this.currentState });
      
      // 开始状态机执行
      await this.executeStateLoop();
      
    } catch (error: any) {
      console.error('[FSM] Failed to start FSM service:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[FSM] Stopping FSM service...');
      
      this.isRunning = false;
      
      // 清理所有超时
      for (const timeout of this.stateTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.stateTimeouts.clear();

      // 清理当前状态处理器的资源（如定时器、连接等）
      await this.cleanupCurrentStateHandler();

      this.emit('fsm-stopped');
      this.emitFSMEvent('fsm-stopped', { finalState: this.currentState });
      
      console.log('[FSM] FSM service stopped');
    } catch (error: any) {
      console.error('[FSM] Error stopping FSM service:', error);
      throw error;
    }
  }

  getCurrentState(): DeviceState {
    return this.currentState;
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  async transitionTo(state: DeviceState, reason?: string): Promise<void> {
    if (!this.isValidTransition(this.currentState, state)) {
      throw new Error(`Invalid transition from ${this.currentState} to ${state}`);
    }

    await this.performTransition(state, reason);
  }

  registerStateHandler(state: DeviceState, handler: IStateHandler): void {
    if (!handler.canHandle(state)) {
      throw new Error(`Handler ${handler.getName()} cannot handle state ${state}`);
    }

    this.stateHandlers.set(state, handler);
    console.log(`[FSM] Registered handler for state: ${state}`);
  }

  // 私有方法

  private async executeStateLoop(): Promise<void> {
    console.log('[FSM] Starting state execution loop');
    
    while (this.isRunning) {
      try {
        // 在每次循环开始时检查是否还在运行
        if (!this.isRunning) {
          console.log('[FSM] State loop stopped - isRunning = false');
          break;
        }

        const handler = this.stateHandlers.get(this.currentState);
        if (!handler) {
          throw new Error(`No handler found for state: ${this.currentState}`);
        }

        const context: FSMContext = {
          state: this.currentState,
          previousState: this.previousState,
          timestamp: Date.now(),
          attempt: this.attemptCount
        };

        // 设置状态超时
        this.setStateTimeout();

        console.log(`[FSM] Executing state: ${this.currentState}`);
        
        const transition = await handler.handle(context);
        
        // 再次检查是否还在运行
        if (!this.isRunning) {
          console.log('[FSM] State loop stopped during handler execution');
          break;
        }
        
        if (transition.nextState !== this.currentState) {
          await this.performTransition(transition.nextState, transition.reason, transition.data);
        } else {
          // 状态没有改变，重置尝试计数
          console.log(`[FSM] State ${this.currentState} remains unchanged`);
          this.attemptCount = 0;
          
          // 如果状态没有变化且没有延迟，检查是否应该继续运行
          if (!transition.delay || transition.delay === 0) {
            // 对于稳定状态（如 DATA_COLLECT），添加默认延迟避免无限循环
            if (this.currentState === DeviceState.DATA_COLLECT) {
              await this.sleepWithCancellation(30000); // 30秒延迟，可中断
            } else {
              await this.sleepWithCancellation(1000); // 其他状态 1秒延迟，可中断
            }
          }
        }

        // 如果有延迟，等待指定时间
        if (transition.delay && transition.delay > 0) {
          await this.sleepWithCancellation(transition.delay);
        }

      } catch (error: any) {
        console.error(`[FSM] Error in state ${this.currentState}:`, error);
        this.emit('handler-error', {
          state: this.currentState,
          error,
          handler: this.stateHandlers.get(this.currentState)?.getName()
        });

        // 错误处理：尝试转换到错误状态
        if (this.currentState !== DeviceState.ERROR) {
          await this.handleStateError(error);
        } else {
          // 如果已经在错误状态，尝试恢复而不是停止FSM
          console.error('[FSM] Error in ERROR state, attempting recovery');
          this.attemptCount++;
          
          if (this.attemptCount >= this.config.maxRetries * 2) {
            // 多次恢复失败，停止FSM
            console.error('[FSM] Multiple recovery attempts failed, stopping FSM');
            await this.stop();
            break;
          } else {
            // 等待一段时间后尝试恢复到HEARTBEAT状态
            console.log('[FSM] Waiting before recovery attempt...');
            await this.sleep(5000);
            await this.performTransition(DeviceState.HEARTBEAT, 'ERROR state recovery attempt');
          }
        }
      }
    }
    
    console.log('[FSM] State execution loop ended');
  }

  private async performTransition(newState: DeviceState, reason?: string, data?: any): Promise<void> {
    if (!this.isValidTransition(this.currentState, newState)) {
      throw new Error(`Invalid transition from ${this.currentState} to ${newState}`);
    }

    const oldState = this.currentState;
    
    // 清理当前状态的超时
    this.clearStateTimeout(oldState);

    // 记录转换历史
    this.recordTransition(oldState, newState, reason, data);

    // 执行状态转换
    this.previousState = oldState;
    this.currentState = newState;
    this.stateStartTime = new Date();
    this.attemptCount = 0;

    // 发出状态变化事件
    this.emit('state-changed', {
      from: oldState,
      to: newState,
      reason,
      timestamp: Date.now(),
      data
    });

    console.log(`[FSM] State transition: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`);

    // 输出状态诊断信息
    this.logStateDiagnostics(newState);
  }

  /**
   * 输出状态诊断信息
   */
  private logStateDiagnostics(state: DeviceState): void {
    const stateNames: Record<DeviceState, string> = {
      [DeviceState.INIT]: '初始化',
      [DeviceState.HEARTBEAT]: '心跳连接',
      [DeviceState.REGISTER]: '设备注册',
      [DeviceState.BIND_CHECK]: '绑定检查',
      [DeviceState.WS_CHECK]: 'WebSocket连接',
      [DeviceState.CONFIG_FETCH]: '配置获取',
      [DeviceState.DATA_COLLECT]: '✅ 在线 - 数据收集中',
      [DeviceState.UNBOUND]: '⚠️ 设备未绑定',
      [DeviceState.DISCONNECT]: '❌ 断开连接',
      [DeviceState.ERROR]: '❌ 错误状态'
    };

    const stateExplanations: Record<DeviceState, string> = {
      [DeviceState.INIT]: '正在初始化客户端...',
      [DeviceState.HEARTBEAT]: '正在连接服务器...',
      [DeviceState.REGISTER]: '正在注册设备到服务器...',
      [DeviceState.BIND_CHECK]: '正在检查设备是否已绑定员工...',
      [DeviceState.WS_CHECK]: '正在建立实时通信通道...',
      [DeviceState.CONFIG_FETCH]: '正在获取监控配置...',
      [DeviceState.DATA_COLLECT]: '✅ 客户端已上线，正在收集监控数据',
      [DeviceState.UNBOUND]: '⚠️ 设备未绑定到员工账户，等待管理员绑定',
      [DeviceState.DISCONNECT]: '❌ 与服务器断开连接，正在重连...',
      [DeviceState.ERROR]: '❌ 发生错误，正在尝试恢复...'
    };

    console.log('='.repeat(60));
    console.log(`📊 当前状态: ${stateNames[state]}`);
    console.log(`💬 说明: ${stateExplanations[state]}`);
    console.log(`⏱️  状态持续时间: ${this.getStateDuration()}秒`);

    // 如果是DATA_COLLECT状态，表示已上线
    if (state === DeviceState.DATA_COLLECT) {
      console.log('🎉 客户端已成功上线！');
    } else if (state === DeviceState.UNBOUND) {
      console.log('⚠️  请登录 Web 控制台将此设备绑定到员工账户');
    } else if (state === DeviceState.DISCONNECT || state === DeviceState.ERROR) {
      console.log('🔧 故障排查建议:');
      console.log('   1. 检查网络连接');
      console.log('   2. 确认服务器地址正确');
      console.log('   3. 检查防火墙设置');
    }

    console.log('='.repeat(60));
  }

  /**
   * 获取当前状态持续时间（秒）
   */
  private getStateDuration(): number {
    return Math.floor((Date.now() - this.stateStartTime.getTime()) / 1000);
  }

  private isValidTransition(from: DeviceState, to: DeviceState): boolean {
    const allowedTransitions = this.config.transitions[from];
    return allowedTransitions ? allowedTransitions.includes(to) : false;
  }

  private recordTransition(from: DeviceState, to: DeviceState, reason?: string, data?: any): void {
    this.transitionHistory.push({
      from,
      to,
      timestamp: new Date(),
      reason,
      data: this.sanitizeData(data)
    });

    // 限制历史记录大小
    if (this.transitionHistory.length > 100) {
      this.transitionHistory = this.transitionHistory.slice(-50);
    }
  }

  private sanitizeData(data: any): any {
    if (!data) return undefined;
    
    try {
      const serialized = JSON.stringify(data);
      if (serialized.length > 1000) {
        return { _truncated: true, size: serialized.length };
      }
      return data;
    } catch {
      return { _error: 'Failed to serialize data' };
    }
  }

  private setStateTimeout(): void {
    const timeout = this.config.timeouts[this.currentState];
    if (timeout > 0) {
      const timeoutId = setTimeout(() => {
        console.warn(`[FSM] State ${this.currentState} timeout after ${timeout}ms`);
        this.handleStateTimeout();
      }, timeout);
      
      this.stateTimeouts.set(this.currentState, timeoutId);
    }
  }

  private clearStateTimeout(state: DeviceState): void {
    const timeoutId = this.stateTimeouts.get(state);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.stateTimeouts.delete(state);
    }
  }

  private async handleStateTimeout(): Promise<void> {
    console.warn(`[FSM] Handling timeout for state: ${this.currentState}`);
    
    // 如果当前状态是 ERROR，尝试恢复到可用状态
    if (this.currentState === DeviceState.ERROR) {
      console.log('[FSM] ERROR state timeout, attempting recovery to HEARTBEAT');
      await this.performTransition(DeviceState.HEARTBEAT, 'ERROR state timeout recovery');
      return;
    }
    
    // 增加重试次数
    this.attemptCount++;
    
    if (this.attemptCount >= this.config.maxRetries) {
      // 超过最大重试次数，转换到错误状态
      await this.performTransition(DeviceState.ERROR, 'Max retries exceeded');
    } else {
      // 重试当前状态，不进行状态转换，只是重新设置超时
      console.log(`[FSM] Retrying state ${this.currentState} (attempt ${this.attemptCount})`);
      // 清除当前状态的超时，重新设置
      this.clearStateTimeout(this.currentState);
      this.setStateTimeout();
    }
  }

  private async handleStateError(error: Error): Promise<void> {
    this.attemptCount++;
    
    if (this.attemptCount >= this.config.maxRetries) {
      console.error(`[FSM] Max retries exceeded for state ${this.currentState}, transitioning to ERROR`);
      await this.performTransition(DeviceState.ERROR, `Max retries exceeded: ${error.message}`);
    } else {
      console.warn(`[FSM] Retrying state ${this.currentState} after error (attempt ${this.attemptCount}):`, error.message);
      
      // 等待重试延迟
      await this.sleep(this.config.retryDelay * this.attemptCount);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 可中断的睡眠函数，当 FSM 停止时会立即返回
   */
  private sleepWithCancellation(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = 100; // 每100ms检查一次停止状态
      let elapsed = 0;
      
      const timer = setInterval(() => {
        elapsed += checkInterval;
        
        if (!this.isRunning) {
          clearInterval(timer);
          console.log(`[FSM] Sleep cancelled after ${elapsed}ms due to stop signal`);
          resolve();
          return;
        }
        
        if (elapsed >= ms) {
          clearInterval(timer);
          resolve();
        }
      }, checkInterval);
    });
  }

  /**
   * 清理当前状态处理器的资源
   */
  private async cleanupCurrentStateHandler(): Promise<void> {
    try {
      const currentHandler = this.stateHandlers.get(this.currentState);
      if (currentHandler) {
        // 检查处理器是否有 cleanup 方法
        if (typeof (currentHandler as any).cleanup === 'function') {
          console.log(`[FSM] Cleaning up resources for state: ${this.currentState}`);
          await (currentHandler as any).cleanup();
        }
        
        // 特殊处理 DATA_COLLECT 状态，确保停止所有监控活动
        if (this.currentState === DeviceState.DATA_COLLECT && typeof (currentHandler as any).stopDataCollection === 'function') {
          console.log('[FSM] Forcing stop of data collection');
          await (currentHandler as any).stopDataCollection();
        }
      }
    } catch (error) {
      console.error('[FSM] Error cleaning up state handler:', error);
    }
  }

  private emitFSMEvent(type: string, data: any): void {
    const event: FSMEvent = {
      type: type as any,
      data,
      timestamp: Date.now()
    };
    
    this.emit('fsm-event', event);
  }

  // 公共方法

  getTransitionHistory(limit: number = 10): Array<{
    from: DeviceState;
    to: DeviceState;
    timestamp: Date;
    reason?: string;
  }> {
    return this.transitionHistory.slice(-limit);
  }

  getStateMetrics(): {
    currentState: DeviceState;
    stateStartTime: Date;
    stateDuration: number;
    previousState?: DeviceState;
    attemptCount: number;
    isRunning: boolean;
  } {
    return {
      currentState: this.currentState,
      stateStartTime: this.stateStartTime,
      stateDuration: Date.now() - this.stateStartTime.getTime(),
      previousState: this.previousState,
      attemptCount: this.attemptCount,
      isRunning: this.isRunning
    };
  }

  updateConfiguration(updates: Partial<FSMConfiguration>): void {
    this.config = { ...this.config, ...updates };
    console.log('[FSM] Configuration updated');
  }

  // 初始化状态处理器
  private initializeStateHandlers(): boolean {
    if (!this.stateHandlerFactory) {
      console.warn('[FSM] No state handler factory available, creating minimal handlers');
      this.createMinimalHandlers();
      return true;
    }

    try {
      // 验证状态处理器
      const validation = this.stateHandlerFactory.validateHandlers();
      if (!validation.valid) {
        console.error('[FSM] State handler validation failed:', validation.errors);
        console.error('[FSM] Missing handlers for states:', validation.missing);
      }

      // 创建所有状态处理器
      const handlers = this.stateHandlerFactory.createAllHandlers();
      
      // 注册所有状态处理器
      for (const [state, handler] of handlers) {
        this.registerStateHandler(state, handler);
      }

      console.log(`[FSM] Successfully initialized ${handlers.size} state handlers`);
      return true;
    } catch (error: any) {
      console.error('[FSM] Failed to initialize state handlers:', error);
      
      // 降级到最小处理器
      console.log('[FSM] Falling back to minimal handlers');
      this.createMinimalHandlers();
      return true;
    }
  }

  // 创建最小状态处理器 (降级方案)
  private createMinimalHandlers(): void {
    const states = [
      DeviceState.INIT,
      DeviceState.HEARTBEAT,
      DeviceState.REGISTER,
      DeviceState.BIND_CHECK,
      DeviceState.WS_CHECK,
      DeviceState.CONFIG_FETCH,
      DeviceState.DATA_COLLECT,
      DeviceState.UNBOUND,
      DeviceState.DISCONNECT,
      DeviceState.ERROR
    ];

    for (const state of states) {
      const handler = {
        getName: () => `Minimal${state}Handler`,
        canHandle: (s: DeviceState) => s === state,
        handle: async (context: FSMContext): Promise<StateTransition> => {
          console.log(`[FSM] Minimal handler for state: ${state}`);
          
          // 基本状态转换逻辑
          switch (state) {
            case DeviceState.INIT:
              return { nextState: DeviceState.HEARTBEAT, reason: 'Init completed', delay: 1000 };
            case DeviceState.HEARTBEAT:
              return { nextState: DeviceState.REGISTER, reason: 'Heartbeat OK', delay: 2000 };
            case DeviceState.REGISTER:
              return { nextState: DeviceState.DATA_COLLECT, reason: 'Registration OK', delay: 1000 };
            case DeviceState.DATA_COLLECT:
              return { nextState: DeviceState.DATA_COLLECT, reason: 'Collecting data', delay: 30000 };
            case DeviceState.ERROR:
              return { nextState: DeviceState.INIT, reason: 'Retry from error', delay: 5000 };
            default:
              return { nextState: DeviceState.DATA_COLLECT, reason: 'Default transition', delay: 2000 };
          }
        }
      };
      
      this.registerStateHandler(state, handler as IStateHandler);
    }

    console.log(`[FSM] Created minimal handlers for ${states.length} states`);
  }
}

// Export DeviceState for external use
export { DeviceState } from '../../interfaces/fsm-interfaces';