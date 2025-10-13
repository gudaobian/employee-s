/**
 * FSM服务模块统一导出
 * 重构版本 - FSM相关组件的统一入口
 */

// 核心FSM服务
export { DeviceFSMService } from './device-fsm-service';

// 基础状态处理器
export { BaseStateHandler } from './base-state-handler';

// 状态处理器和工厂
export * from './state-handlers';

// FSM接口定义
export {
  IDeviceFSMService,
  IStateHandler,
  DeviceState,
  FSMContext,
  StateTransition,
  StateHandlerResult,
  FSMConfiguration,
  FSMEvent
} from '../../interfaces/fsm-interfaces';

// FSM服务管理器类
import { DeviceFSMService } from './device-fsm-service';
import { StateHandlerFactory } from './state-handlers';
import { ActivityCollectorService } from '../activity-collector-service';
import { IConfigService, IWebSocketService } from '../../interfaces/service-interfaces';
import { IPlatformAdapter } from '../../interfaces/platform-interface';
import { DeviceState } from '../../interfaces/fsm-interfaces';
import { EventEmitter } from 'events';

export class FSMServiceManager extends EventEmitter {
  private fsmService: DeviceFSMService;
  private handlerFactory: StateHandlerFactory;
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;
  private appInstance?: EventEmitter;
  private websocketService?: IWebSocketService;

  constructor(
    configService: IConfigService,
    platformAdapter: IPlatformAdapter,
    appInstance?: EventEmitter,
    activityCollectorService?: ActivityCollectorService,
    websocketService?: IWebSocketService
  ) {
    super();
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.appInstance = appInstance;
    this.websocketService = websocketService;

    this.fsmService = new DeviceFSMService(
      configService,
      platformAdapter,
      appInstance,
      activityCollectorService,
      websocketService
    );
    this.handlerFactory = new StateHandlerFactory(
      configService,
      platformAdapter,
      appInstance,
      activityCollectorService,
      websocketService
    );
    
    // 设置配置更新事件转发
    this.on('config-update', (configData) => {
      console.log('[FSMServiceManager] Forwarding config-update to app instance');
      if (this.appInstance) {
        this.appInstance.emit('config-update', configData);
      }
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('[FSMServiceManager] Initializing FSM service...');

      // 验证状态处理器
      const validation = this.handlerFactory.validateHandlers();
      if (!validation.valid) {
        console.error('[FSMServiceManager] Handler validation failed:', validation);
        throw new Error(`Handler validation failed: ${validation.errors.length} errors, ${validation.missing.length} missing`);
      }

      // 创建并注册所有状态处理器
      const handlers = this.handlerFactory.createAllHandlers();
      
      for (const [state, handler] of handlers) {
        this.fsmService.registerStateHandler(state, handler);
      }

      console.log(`[FSMServiceManager] FSM service initialized with ${handlers.size} handlers`);

      // 设置事件监听器
      this.setupEventListeners();

    } catch (error: any) {
      console.error('[FSMServiceManager] Failed to initialize FSM service:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      console.log('[FSMServiceManager] Starting FSM service...');
      await this.fsmService.start();
      console.log('[FSMServiceManager] FSM service started successfully');
    } catch (error: any) {
      console.error('[FSMServiceManager] Failed to start FSM service:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      console.log('[FSMServiceManager] Stopping FSM service...');
      await this.fsmService.stop();
      console.log('[FSMServiceManager] FSM service stopped successfully');
    } catch (error: any) {
      console.error('[FSMServiceManager] Failed to stop FSM service:', error);
      throw error;
    }
  }

  getCurrentState(): DeviceState {
    return this.fsmService.getCurrentState();
  }

  getStateMetrics() {
    return this.fsmService.getStateMetrics();
  }

  getTransitionHistory(limit?: number) {
    return this.fsmService.getTransitionHistory(limit);
  }

  async transitionTo(state: DeviceState, reason?: string): Promise<void> {
    return this.fsmService.transitionTo(state, reason);
  }

  private setupEventListeners(): void {
    try {
      // FSM状态变化事件
      this.fsmService.on('state-changed', (event) => {
        console.log(`[FSMServiceManager] State changed: ${event.from} → ${event.to}`);
        if (event.reason) {
          console.log(`[FSMServiceManager] Reason: ${event.reason}`);
        }
      });

      // FSM启动事件
      this.fsmService.on('fsm-started', () => {
        console.log('[FSMServiceManager] FSM service started');
      });

      // FSM停止事件
      this.fsmService.on('fsm-stopped', () => {
        console.log('[FSMServiceManager] FSM service stopped');
      });

      // 处理器错误事件
      this.fsmService.on('handler-error', (event) => {
        console.error(`[FSMServiceManager] Handler error in state ${event.state}:`, event.error);
        console.error(`[FSMServiceManager] Handler: ${event.handler}`);
      });

      // FSM通用事件
      this.fsmService.on('fsm-event', (event) => {
        console.log(`[FSMServiceManager] FSM event: ${event.type}`, event.data);
      });

      // 错误事件
      this.fsmService.on('error', (error) => {
        console.error('[FSMServiceManager] FSM service error:', error);
      });

      console.log('[FSMServiceManager] Event listeners configured');

    } catch (error: any) {
      console.error('[FSMServiceManager] Failed to setup event listeners:', error);
    }
  }

  // 健康检查
  healthCheck(): {
    healthy: boolean;
    details: {
      isRunning: boolean;
      currentState: DeviceState;
      stateDuration: number;
      lastTransitionTime?: Date;
      handlerCount: number;
    };
  } {
    try {
      const metrics = this.fsmService.getStateMetrics();
      const transitionHistory = this.fsmService.getTransitionHistory(1);
      
      return {
        healthy: metrics.isRunning,
        details: {
          isRunning: metrics.isRunning,
          currentState: metrics.currentState,
          stateDuration: metrics.stateDuration,
          lastTransitionTime: transitionHistory.length > 0 ? transitionHistory[0].timestamp : undefined,
          handlerCount: this.handlerFactory.createAllHandlers().size
        }
      };

    } catch (error: any) {
      console.error('[FSMServiceManager] Health check failed:', error);
      return {
        healthy: false,
        details: {
          isRunning: false,
          currentState: DeviceState.ERROR,
          stateDuration: 0,
          handlerCount: 0
        }
      };
    }
  }

  // 获取详细状态信息
  getDetailedStatus(): {
    fsm: any;
    handlers: any;
    configuration: any;
  } {
    try {
      const validation = this.handlerFactory.validateHandlers();
      
      return {
        fsm: {
          ...this.fsmService.getStateMetrics(),
          transitionHistory: this.fsmService.getTransitionHistory(5)
        },
        handlers: {
          validation: validation,
          count: this.handlerFactory.createAllHandlers().size
        },
        configuration: {
          // 可以添加配置信息
        }
      };

    } catch (error: any) {
      console.error('[FSMServiceManager] Failed to get detailed status:', error);
      return {
        fsm: { error: error.message },
        handlers: { error: error.message },
        configuration: { error: error.message }
      };
    }
  }
}