/**
 * FSM状态处理器统一导出
 * 重构版本 - 所有状态处理器的入口点
 */

// 基础状态处理器
export { BaseStateHandler } from '../base-state-handler';

// 具体状态处理器
export { InitStateHandler } from './init-state-handler';
export { HeartbeatStateHandler } from './heartbeat-state-handler';
export { RegisterStateHandler } from './register-state-handler';
export { BindCheckStateHandler } from './bind-check-state-handler';
export { WSCheckStateHandler } from './ws-check-state-handler';
export { ConfigFetchStateHandler } from './config-fetch-state-handler';
export { DataCollectStateHandler } from './data-collect-state-handler';
export { UnboundStateHandler } from './unbound-state-handler';
export { DisconnectStateHandler } from './disconnect-state-handler';
export { ErrorStateHandler } from './error-state-handler';

// 状态处理器工厂类
import { InitStateHandler } from './init-state-handler';
import { HeartbeatStateHandler } from './heartbeat-state-handler';
import { RegisterStateHandler } from './register-state-handler';
import { BindCheckStateHandler } from './bind-check-state-handler';
import { WSCheckStateHandler } from './ws-check-state-handler';
import { ConfigFetchStateHandler } from './config-fetch-state-handler';
import { DataCollectStateHandler } from './data-collect-state-handler';
import { UnboundStateHandler } from './unbound-state-handler';
import { DisconnectStateHandler } from './disconnect-state-handler';
import { ErrorStateHandler } from './error-state-handler';

import { DeviceState } from '../../../interfaces/fsm-interfaces';
import { IConfigService, IWebSocketService } from '../../../interfaces/service-interfaces';
import { IPlatformAdapter } from '../../../interfaces/platform-interface';
import { ActivityCollectorService } from '../../activity-collector-service';
import { EventEmitter } from 'events';

export class StateHandlerFactory {
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;
  private appInstance?: EventEmitter;
  private activityCollectorService?: ActivityCollectorService;
  private websocketService?: IWebSocketService;
  private dataSyncService?: any;

  // CRITICAL: Cache handlers to prevent memory leaks from duplicate instances
  // Each handler instance registers event listeners, so creating duplicates
  // causes listener accumulation and memory explosion
  private handlerCache: Map<DeviceState, any> = new Map();

  constructor(
    configService: IConfigService,
    platformAdapter: IPlatformAdapter,
    appInstance?: EventEmitter,
    activityCollectorService?: ActivityCollectorService,
    websocketService?: IWebSocketService,
    dataSyncService?: any
  ) {
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.appInstance = appInstance;
    this.activityCollectorService = activityCollectorService;
    this.websocketService = websocketService;
    this.dataSyncService = dataSyncService;
  }

  createHandler(state: DeviceState) {
    // CRITICAL: Check cache first to prevent duplicate handler instances
    // Duplicate handlers cause event listener memory leaks
    if (this.handlerCache.has(state)) {
      console.log(`[StateHandlerFactory] ✅ Returning cached handler for state: ${state}`);
      return this.handlerCache.get(state);
    }

    console.log(`[StateHandlerFactory] 🆕 Creating new handler for state: ${state}`);

    let handler: any;

    switch (state) {
      case DeviceState.INIT:
        handler = new InitStateHandler(this.configService);
        break;

      case DeviceState.HEARTBEAT:
        handler = new HeartbeatStateHandler(this.configService);
        break;

      case DeviceState.REGISTER:
        handler = new RegisterStateHandler(this.configService, this.platformAdapter);
        break;

      case DeviceState.BIND_CHECK:
        handler = new BindCheckStateHandler(this.configService);
        break;

      case DeviceState.WS_CHECK:
        handler = new WSCheckStateHandler(this.configService);
        break;

      case DeviceState.CONFIG_FETCH:
        handler = new ConfigFetchStateHandler(this.configService);
        break;

      case DeviceState.DATA_COLLECT:
        handler = new DataCollectStateHandler(
          this.configService,
          this.platformAdapter,
          this.appInstance,
          this.activityCollectorService,
          this.websocketService,
          this.dataSyncService
        );
        break;

      case DeviceState.UNBOUND:
        handler = new UnboundStateHandler(this.configService);
        break;

      case DeviceState.DISCONNECT:
        handler = new DisconnectStateHandler(this.configService);
        break;

      case DeviceState.ERROR:
        handler = new ErrorStateHandler(this.configService);
        break;

      default:
        throw new Error(`No handler available for state: ${state}`);
    }

    // Store in cache before returning
    this.handlerCache.set(state, handler);
    return handler;
  }

  createAllHandlers(): Map<DeviceState, any> {
    // CRITICAL: Use createHandler() which now implements caching
    // This prevents duplicate handler instances and event listener leaks
    console.log('[StateHandlerFactory] Creating all handlers (with caching)...');

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

    const handlers = new Map();

    for (const state of states) {
      try {
        // Use createHandler which implements caching
        const handler = this.createHandler(state);
        handlers.set(state, handler);
      } catch (error: any) {
        console.error(`[StateHandlerFactory] Failed to create handler for state ${state}:`, error);
      }
    }

    console.log(`[StateHandlerFactory] ✅ Handlers ready: ${handlers.size} total, ${this.handlerCache.size} in cache`);
    return handlers;
  }

  /**
   * Get the count of cached handlers without creating new instances
   * CRITICAL: Use this for diagnostics instead of createAllHandlers()
   */
  getHandlerCount(): number {
    return this.handlerCache.size;
  }

  // 验证所有处理器是否正确创建
  validateHandlers(): {
    valid: boolean;
    missing: DeviceState[];
    errors: Array<{ state: DeviceState; error: string }>;
  } {
    const allStates = [
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

    const missing: DeviceState[] = [];
    const errors: Array<{ state: DeviceState; error: string }> = [];

    for (const state of allStates) {
      try {
        const handler = this.createHandler(state);
        
        // 验证处理器是否有必要的方法
        if (typeof handler.handle !== 'function') {
          errors.push({
            state,
            error: 'Handler missing handle method'
          });
        }

        if (typeof handler.canHandle !== 'function') {
          errors.push({
            state,
            error: 'Handler missing canHandle method'
          });
        }

        if (!handler.canHandle(state)) {
          errors.push({
            state,
            error: 'Handler cannot handle its assigned state'
          });
        }

      } catch (error: any) {
        missing.push(state);
        errors.push({
          state,
          error: error.message
        });
      }
    }

    return {
      valid: missing.length === 0 && errors.length === 0,
      missing,
      errors
    };
  }
}