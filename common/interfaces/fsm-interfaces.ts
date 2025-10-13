/**
 * FSM状态机接口定义
 * 定义FSM相关的接口和类型
 */

export enum DeviceState {
  INIT = 'INIT',
  HEARTBEAT = 'HEARTBEAT',
  REGISTER = 'REGISTER',
  BIND_CHECK = 'BIND_CHECK',
  WS_CHECK = 'WS_CHECK',
  CONFIG_FETCH = 'CONFIG_FETCH',
  DATA_COLLECT = 'DATA_COLLECT',
  UNBOUND = 'UNBOUND',
  DISCONNECT = 'DISCONNECT',
  ERROR = 'ERROR'
}

export interface IStateHandler {
  handle(context: FSMContext): Promise<StateTransition>;
  canHandle(state: DeviceState): boolean;
  getName(): string;
}

export interface IDeviceFSMService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCurrentState(): DeviceState;
  transitionTo(state: DeviceState, reason?: string): Promise<void>;
  registerStateHandler(state: DeviceState, handler: IStateHandler): void;
  on(event: string, callback: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

export interface FSMContext {
  state: DeviceState;
  previousState?: DeviceState;
  data?: any;
  error?: Error;
  timestamp: number;
  attempt: number;
}

export interface StateTransition {
  nextState: DeviceState;
  reason?: string;
  delay?: number;
  data?: any;
  error?: Error;
}

export interface StateHandlerResult {
  success: boolean;
  nextState?: DeviceState;
  reason?: string;
  data?: any;
  error?: Error;
  shouldRetry?: boolean;
  retryDelay?: number;
}

export interface FSMConfiguration {
  initialState: DeviceState;
  maxRetries: number;
  retryDelay: number;
  timeouts: Record<DeviceState, number>;
  transitions: Record<DeviceState, DeviceState[]>;
}

export interface FSMEvent {
  type: 'state-changed' | 'handler-error' | 'fsm-started' | 'fsm-stopped';
  data: any;
  timestamp: number;
}

export interface StateMetrics {
  state: DeviceState;
  enterCount: number;
  totalTime: number;
  averageTime: number;
  errorCount: number;
  lastEnter: number;
  lastExit: number;
}