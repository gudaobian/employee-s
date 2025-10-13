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

  constructor(
    configService: IConfigService,
    platformAdapter: IPlatformAdapter,
    appInstance?: EventEmitter,
    activityCollectorService?: ActivityCollectorService,
    websocketService?: IWebSocketService
  ) {
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.appInstance = appInstance;
    this.activityCollectorService = activityCollectorService;
    this.websocketService = websocketService;
  }

  createHandler(state: DeviceState) {
    switch (state) {
      case DeviceState.INIT:
        return new InitStateHandler(this.configService);
        
      case DeviceState.HEARTBEAT:
        return new HeartbeatStateHandler(this.configService);
        
      case DeviceState.REGISTER:
        return new RegisterStateHandler(this.configService, this.platformAdapter);
        
      case DeviceState.BIND_CHECK:
        return new BindCheckStateHandler(this.configService);
        
      case DeviceState.WS_CHECK:
        return new WSCheckStateHandler(this.configService);
        
      case DeviceState.CONFIG_FETCH:
        return new ConfigFetchStateHandler(this.configService);

      case DeviceState.DATA_COLLECT:
        return new DataCollectStateHandler(
          this.configService,
          this.platformAdapter,
          this.appInstance,
          this.activityCollectorService,
          this.websocketService
        );
        
      case DeviceState.UNBOUND:
        return new UnboundStateHandler(this.configService);
        
      case DeviceState.DISCONNECT:
        return new DisconnectStateHandler(this.configService);
        
      case DeviceState.ERROR:
        return new ErrorStateHandler(this.configService);
        
      default:
        throw new Error(`No handler available for state: ${state}`);
    }
  }

  createAllHandlers(): Map<DeviceState, any> {
    const handlers = new Map();
    
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
      try {
        const handler = this.createHandler(state);
        handlers.set(state, handler);
        console.log(`[StateHandlerFactory] Created handler for state: ${state}`);
      } catch (error: any) {
        console.error(`[StateHandlerFactory] Failed to create handler for state ${state}:`, error);
      }
    }

    console.log(`[StateHandlerFactory] Created ${handlers.size} state handlers`);
    return handlers;
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