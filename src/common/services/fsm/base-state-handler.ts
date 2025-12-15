/**
 * 基础状态处理器
 * 提供状态处理器的通用功能和默认实现
 */

import { 
  IStateHandler, 
  DeviceState, 
  FSMContext, 
  StateTransition, 
  StateHandlerResult 
} from '../../interfaces/fsm-interfaces';

export abstract class BaseStateHandler implements IStateHandler {
  protected readonly supportedStates: DeviceState[] = [];
  protected readonly handlerName: string;
  protected lastExecutionTime: number = 0;
  protected executionCount: number = 0;

  constructor(name: string, supportedStates: DeviceState[]) {
    this.handlerName = name;
    this.supportedStates = supportedStates;
  }

  canHandle(state: DeviceState): boolean {
    return this.supportedStates.includes(state);
  }

  getName(): string {
    return this.handlerName;
  }

  async handle(context: FSMContext): Promise<StateTransition> {
    this.lastExecutionTime = Date.now();
    this.executionCount++;

    try {
      console.log(`[${this.handlerName}] Handling state: ${context.state} (attempt: ${context.attempt})`);
      
      const result = await this.execute(context);
      
      return this.createTransition(result);
    } catch (error: any) {
      console.error(`[${this.handlerName}] Error handling state ${context.state}:`, error);
      
      return this.handleError(context, error);
    }
  }

  // 抽象方法 - 子类必须实现
  protected abstract execute(context: FSMContext): Promise<StateHandlerResult>;

  // 钩子方法 - 子类可以重写
  protected onEnter(context: FSMContext): Promise<void> {
    return Promise.resolve();
  }

  protected onExit(context: FSMContext): Promise<void> {
    return Promise.resolve();
  }

  protected onRetry(context: FSMContext, previousError?: Error): Promise<void> {
    console.log(`[${this.handlerName}] Retrying state ${context.state} (attempt: ${context.attempt})`);
    return Promise.resolve();
  }

  // 工具方法
  protected createTransition(result: StateHandlerResult): StateTransition {
    return {
      nextState: result.nextState || DeviceState.ERROR,
      reason: result.reason,
      delay: result.retryDelay,
      data: result.data,
      error: result.error
    };
  }

  protected handleError(context: FSMContext, error: Error): StateTransition {
    console.error(`[${this.handlerName}] State ${context.state} failed:`, error.message);
    
    return {
      nextState: DeviceState.ERROR,
      reason: `${this.handlerName} failed: ${error.message}`,
      error
    };
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected async retry<T>(
    operation: () => Promise<T>, 
    maxAttempts: number = 3, 
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        console.warn(`[${this.handlerName}] Attempt ${attempt} failed:`, error);
        
        if (attempt < maxAttempts) {
          await this.sleep(delay * attempt);
        }
      }
    }
    
    throw lastError || new Error('Operation failed after retries');
  }

  protected validateContext(context: FSMContext): void {
    if (!context.state) {
      throw new Error('Context missing state');
    }
    
    if (!this.canHandle(context.state)) {
      throw new Error(`Handler ${this.handlerName} cannot handle state ${context.state}`);
    }
  }

  protected isRetryableError(error: Error): boolean {
    // 默认的可重试错误类型
    const retryableErrors = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'CONNECTION_REFUSED',
      'TEMPORARY_FAILURE'
    ];
    
    return retryableErrors.some(type => 
      error.message.includes(type) || 
      error.name.includes(type)
    );
  }

  // 状态处理器统计信息
  getStatistics() {
    return {
      handlerName: this.handlerName,
      supportedStates: this.supportedStates,
      executionCount: this.executionCount,
      lastExecutionTime: this.lastExecutionTime,
      avgExecutionTime: this.lastExecutionTime > 0 ? 
        (Date.now() - this.lastExecutionTime) / this.executionCount : 0
    };
  }

  // 健康检查
  healthCheck(): { healthy: boolean; details: any } {
    return {
      healthy: true,
      details: {
        name: this.handlerName,
        supportedStates: this.supportedStates,
        executionCount: this.executionCount,
        lastExecution: this.lastExecutionTime
      }
    };
  }
}