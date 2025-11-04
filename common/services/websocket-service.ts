/**
 * WebSocket服务 - 重构版本
 * 负责与服务器的实时通信
 */

import { EventEmitter } from 'events';
import { io, Socket } from 'socket.io-client';
import { IConfigService, IWebSocketService } from '../interfaces/service-interfaces';

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
  messageId?: string;
}

interface ConnectionStats {
  connectedAt?: Date;
  lastMessageAt?: Date;
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export class WebSocketService extends EventEmitter implements IWebSocketService {
  private configService: IConfigService;
  private socket?: Socket; // Socket.IO客户端实例
  private websocketUrl?: string;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5秒
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;
  private heartbeatIntervalMs = 30000; // 30秒心跳
  private messageQueue: WebSocketMessage[] = [];
  private maxQueueSize = 100;

  private stats: ConnectionStats = {
    messagesSent: 0,
    messagesReceived: 0,
    reconnectAttempts: 0,
    maxReconnectAttempts: this.maxReconnectAttempts
  };

  constructor(configService: IConfigService) {
    super();
    this.configService = configService;
    this.setMaxListeners(20);
    
    // 监听配置变更事件，实现立即重连
    this.configService.on('config-updated', this.handleConfigUpdate.bind(this));
  }

  async connect(websocketUrl?: string): Promise<void> {
    if (this.isConnected() || this.isConnecting) {
      console.log('[WEBSOCKET] Already connected or connecting');
      return;
    }

    try {
      console.log('[WEBSOCKET] Connecting to WebSocket server...');

      this.isConnecting = true;
      this.websocketUrl = websocketUrl || this.buildWebSocketUrl();

      // 创建Socket.IO客户端
      this.socket = this.createSocketIOClient();
      if (!this.socket) {
        throw new Error('Socket.IO client creation failed');
      }
      
      // 设置事件监听器
      this.setupEventListeners();
      
      // 启动连接
      this.socket.connect();

      console.log(`[WEBSOCKET] Connecting to: ${this.websocketUrl}`);

    } catch (error: any) {
      console.error('[WEBSOCKET] Failed to initiate connection:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        type: error?.type,
        code: error?.code,
        name: error?.name
      });
      this.isConnecting = false;
      this.handleConnectionError(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      console.log('[WEBSOCKET] Disconnecting...');

      this.shouldReconnect = false;
      this.isConnecting = false;

      // 停止心跳
      this.stopHeartbeat();

      // 清理定时器
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = undefined;
      }

      // 关闭连接
      if (this.socket) {
        this.socket.disconnect();
        this.socket = undefined;
      }

      // 清空消息队列
      this.messageQueue = [];

      console.log('[WEBSOCKET] Disconnected');
      this.emit('disconnected');

    } catch (error: any) {
      console.error('[WEBSOCKET] Error during disconnect:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        type: error?.type,
        code: error?.code
      });
    }
  }

  isConnected(): boolean {
    return this.socket && this.socket.connected;
  }

  async sendMessage(type: string, data: any): Promise<void> {
    const message: WebSocketMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
      messageId: this.generateMessageId()
    };

    await this.sendWebSocketMessage(message);
  }

  async sendActivityData(activityData: any): Promise<void> {
    // 使用Socket.IO事件名
    await this.sendSocketIOEvent('client:activity', activityData);
  }

  async sendScreenshotData(screenshotData: any): Promise<void> {
    await this.sendSocketIOEvent('client:screenshot', screenshotData);
  }

  async sendSystemData(systemData: any): Promise<void> {
    await this.sendSocketIOEvent('client:process', systemData);
  }

  getConnectionStats(): ConnectionStats {
    return { ...this.stats };
  }

  getConnectionStatus(): {
    isConnected: boolean;
    isConnecting: boolean;
    websocketUrl?: string;
    queueSize: number;
    reconnectAttempts: number;
  } {
    return {
      isConnected: this.isConnected(),
      isConnecting: this.isConnecting,
      websocketUrl: this.websocketUrl,
      queueSize: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  // 私有方法

  private createSocketIOClient(): Socket | null {
    try {
      const url = this.websocketUrl!;
      const config = this.configService.getConfig();

      // 确保 deviceId 存在
      if (!config.deviceId) {
        throw new Error('Device ID is required for Socket.IO connection');
      }

      // Socket.IO 连接选项 - 增强的重连配置
      const options = {
        // ✅ 增强传输配置 - 支持降级到轮询
        transports: ['websocket', 'polling'], // WebSocket优先，失败时降级到polling
        upgrade: true, // 允许传输升级
        rememberUpgrade: true, // ✅ 记住升级，提高性能

        // 连接超时配置
        timeout: 20000, // 连接超时 20 秒

        // ✅ 增强重连配置 - 无限重试
        reconnection: true, // 启用自动重连
        reconnectionAttempts: Infinity, // ✅ 无限重试（原来是 5）
        reconnectionDelay: 1000, // 重连延迟
        reconnectionDelayMax: 10000, // ✅ 最大重连延迟 10s（原来是 5s）
        randomizationFactor: 0.5, // 重连延迟随机化

        // ✅ 新增配置 - 连接管理优化
        forceNew: false, // ✅ 复用连接（原来是 true）
        multiplex: true, // ✅ 启用多路复用

        // 消息缓冲配置
        maxHttpBufferSize: 10 * 1024 * 1024, // 增加最大消息大小到 10MB（用于截图传输）

        // 认证配置
        auth: {
          deviceId: config.deviceId,
          // token 是可选的，设备可以无token连接
          token: (config as any).authToken || (config as any).token || undefined
        },

        autoConnect: false
      };

      console.log(`[WEBSOCKET] Creating Socket.IO client for device: ${config.deviceId}`);
      console.log(`[WEBSOCKET] Enhanced reconnection config: reconnectionAttempts=Infinity, reconnectionDelayMax=10000ms`);
      return io(url, options);
    } catch (error) {
      console.error('[WEBSOCKET] Failed to create Socket.IO client:', error);
      return null;
    }
  }

  private buildWebSocketUrl(): string {
    const config = this.configService.getConfig();
    
    console.log(`[WEBSOCKET] Building WebSocket URL from config:`, {
      serverUrl: config.serverUrl,
      websocketUrl: config.websocketUrl
    });
    
    if (config.websocketUrl) {
      console.log(`[WEBSOCKET] Using configured websocketUrl: ${config.websocketUrl}`);
      return config.websocketUrl;
    }

    // 从HTTP URL构建Socket.IO URL，连接到/client命名空间
    // Socket.IO官方推荐使用HTTP/HTTPS URL，它会自动处理WebSocket升级
    if (config.serverUrl) {
      try {
        const baseUrl = config.serverUrl.endsWith('/') ? config.serverUrl.slice(0, -1) : config.serverUrl;
        const socketUrl = `${baseUrl}/client`;
        console.log(`[WEBSOCKET] Built Socket.IO URL from serverUrl: ${socketUrl}`);
        return socketUrl;
      } catch (error: any) {
        console.error(`[WEBSOCKET] Invalid server URL: ${config.serverUrl}`, error);
        throw new Error(`Invalid server URL for Socket.IO: ${config.serverUrl}`);
      }
    }

    throw new Error('No WebSocket URL or server URL configured');
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('[WEBSOCKET] ✅ Socket.IO connection established', {
        socketId: this.socket?.id,
        transport: this.socket?.io.engine.transport.name
      });

      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.stats.connectedAt = new Date();
      this.stats.reconnectAttempts = this.reconnectAttempts;

      // 发送队列中的消息
      this.processMessageQueue();

      // 启动业务心跳
      this.startHeartbeat();

      this.emit('connected');
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log(`[WEBSOCKET] Socket.IO disconnected: ${reason}`);

      this.isConnecting = false;

      this.emit('disconnected', { reason });

      // 自动重连
      if (this.shouldReconnect && reason !== 'io client disconnect') {
        this.scheduleReconnect();
      }
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('[WEBSOCKET] Socket.IO connection error:', {
        message: error?.message || 'Connection error',
        type: error?.type,
        description: error?.description,
        context: error?.context,
        code: error?.code,
        stack: error?.stack,
        url: this.websocketUrl
      });

      // 详细的错误信息记录
      if (error.type === 'TransportError') {
        console.error('[WEBSOCKET] TransportError details:', {
          description: error.description,
          context: error.context,
          type: error.type,
          url: this.websocketUrl
        });

        // 检查是否是网络连接问题
        if (error.description && error.description.code) {
          console.error('[WEBSOCKET] Network error code:', error.description.code);
        }
      }

      this.isConnecting = false;
      this.handleConnectionError(error);
    });

    // ✅ 新增：重连尝试事件
    this.socket.on('reconnect_attempt', (attemptNumber: number) => {
      this.reconnectAttempts = attemptNumber;
      console.log('[WEBSOCKET] 🔄 Reconnect attempt', { attemptNumber });
    });

    // ✅ 新增：重连成功事件
    this.socket.on('reconnect', (attemptNumber: number) => {
      console.log('[WEBSOCKET] ✅ Reconnected successfully', {
        attempts: attemptNumber,
        transport: this.socket?.io.engine.transport.name
      });
      this.emit('reconnected');
    });

    // ✅ 新增：传输升级事件（engine 级别）
    // 注意：engine 只在连接建立后才可用，需要在 connect 事件中设置
    this.socket.once('connect', () => {
      if (this.socket?.io?.engine) {
        this.socket.io.engine.on('upgrade', (transport: any) => {
          console.log('[WEBSOCKET] 🚀 Transport upgraded', {
            from: 'polling',
            to: transport.name
          });
        });

        this.socket.io.engine.on('ping', () => {
          console.log('[WEBSOCKET] 📶 Ping sent');
        });

        this.socket.io.engine.on('pong', () => {
          console.log('[WEBSOCKET] 📶 Pong received');
        });
      } else {
        console.warn('[WEBSOCKET] ⚠️ Engine not available, skipping engine-level event listeners');
      }
    });

    // Socket.IO 事件监听 - 监听后端发送的 'client:config-updated' 事件
    this.socket.on('client:config-updated', (payload: any) => {
      console.log('[WEBSOCKET] Configuration update received from server:', payload);

      // 解包 data 字段（后端推送的格式可能是 { data: { activityInterval: 600000 } }）
      const configData = payload.data || payload;

      console.log('[WEBSOCKET] Extracted config data:', configData);

      // 发出配置更新事件
      this.emit('config-update', configData);
    });

    this.socket.on('command', (data: any) => {
      this.emit('command', data);
    });

    this.socket.on('server_message', (data: any) => {
      this.handleMessage({ type: 'server_message', data, timestamp: new Date().toISOString() });
    });

    // 监听服务器确认消息
    this.socket.on('client:activity:ack', (data: any) => {
      console.log('[WEBSOCKET] Activity data acknowledged by server:', data);
    });

    this.socket.on('client:process:ack', (data: any) => {
      console.log('[WEBSOCKET] Process data acknowledged by server:', data);
    });

    this.socket.on('client:screenshot:ack', (data: any) => {
      console.log('[WEBSOCKET] Screenshot data acknowledged by server:', data);
    });

    // 监听心跳确认
    this.socket.on('client:heartbeat:ack', (data: any) => {
      console.log('[WEBSOCKET] Heartbeat acknowledged by server:', data);
    });

    // 监听服务器错误
    this.socket.on('error', (error: any) => {
      console.error('[WEBSOCKET] Server error:', {
        message: error?.message || 'Server error',
        type: error?.type,
        code: error?.code,
        stack: error?.stack
      });
    });
  }

  private handleMessage(data: any): void {
    try {
      this.stats.messagesReceived++;
      this.stats.lastMessageAt = new Date();

      let message: WebSocketMessage;
      
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else if (data instanceof Buffer) {
        message = JSON.parse(data.toString());
      } else {
        message = data;
      }

      console.log(`[WEBSOCKET] Message received: ${message.type}`);
      
      // 处理不同类型的消息
      switch (message.type) {
        case 'ping':
          this.sendMessage('pong', { timestamp: new Date().toISOString() });
          break;
          
        case 'client:config-updated':
          this.emit('config-update', message.data);
          break;
          
        case 'command':
          this.emit('command', message.data);
          break;
          
        case 'auth_response':
          this.handleAuthResponse(message.data);
          break;
          
        default:
          this.emit('message', message);
          break;
      }

    } catch (error: any) {
      console.error('[WEBSOCKET] Failed to handle message:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        data: typeof data === 'string' ? data.substring(0, 100) : '[Binary data]'
      });
    }
  }

  private async sendSocketIOEvent(event: string, data: any): Promise<void> {
    if (!this.isConnected()) {
      // 添加到队列等待连接
      const message = {
        type: event,
        data,
        timestamp: new Date().toISOString(),
        messageId: this.generateMessageId()
      };
      this.addToQueue(message);
      console.log(`[WEBSOCKET] Event queued (not connected): ${event}`);
      return;
    }

    try {
      const startTime = Date.now();

      // 计算数据大小
      let dataSize = 0;
      try {
        dataSize = JSON.stringify(data).length;
      } catch {
        dataSize = data?.buffer?.length || 0;
      }

      console.log(`[WEBSOCKET] Sending ${event} (${Math.round(dataSize / 1024)} KB)`);

      // 🔍 详细记录要发送的数据（仅针对 activity 事件）
      if (event === 'client:activity') {
        console.log(`[WEBSOCKET] 📤 详细发送数据:`, {
          timestamp: data.timestamp,
          keystrokes: data.keystrokes,
          mouseClicks: data.mouseClicks,
          mouseScrolls: data.mouseScrolls,
          isActive: data.isActive,
          activityInterval: data.activityInterval,
          allKeys: Object.keys(data),
          mouseScrollsType: typeof data.mouseScrolls,
          mouseScrollsValue: data.mouseScrolls
        });
      }

      // 使用 Promise 包装以支持超时和错误处理
      await new Promise<void>((resolve, reject) => {
        // 设置超时: 截图15秒，进程/活动数据10秒，其他5秒
        const timeout = event === 'client:screenshot' ? 15000 :
                        (event === 'client:process' || event === 'client:activity') ? 10000 : 5000;
        const timeoutId = setTimeout(() => {
          reject(new Error(`Upload timeout after ${timeout}ms`));
        }, timeout);

        // 使用Socket.IO emit发送事件
        this.socket!.emit(event, data, (response: any) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;

          if (response && response.success) {
            console.log(`[WEBSOCKET] ✅ Upload SUCCESS: ${event}`, {
              duration: `${duration}ms`,
              dataSize: `${Math.round(dataSize / 1024)} KB`,
              response: response.message || 'OK'
            });
            resolve();
          } else {
            const errorMsg = response?.error || response?.message || 'Unknown error';
            console.error(`[WEBSOCKET] ❌ Upload FAILED: ${event}`, {
              duration: `${duration}ms`,
              dataSize: `${Math.round(dataSize / 1024)} KB`,
              error: errorMsg,
              details: response?.details || response?.data,
              success: response?.success
            });
            reject(new Error(`Server error: ${errorMsg}`));
          }
        });
      });

      this.stats.messagesSent++;

    } catch (error: any) {
      console.error(`[WEBSOCKET] ❌ Failed to send Socket.IO event ${event}:`, {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        code: error?.code
      });
      throw error;
    }
  }

  // 已被 sendSocketIOEvent 替代
  private async sendWebSocketMessage(message: WebSocketMessage): Promise<void> {
    console.warn('[WEBSOCKET] sendWebSocketMessage is deprecated, use sendSocketIOEvent');
    await this.sendSocketIOEvent(message.type, message.data);
  }

  private async sendQueuedMessage(message: WebSocketMessage): Promise<void> {
    if (message.type.startsWith('client:')) {
      // Socket.IO事件
      await this.sendSocketIOEvent(message.type, message.data);
    } else {
      // 其他消息类型
      await this.sendSocketIOEvent('client_message', { type: message.type, data: message.data });
    }
  }

  private addToQueue(message: WebSocketMessage): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      // 移除最旧的消息
      const removed = this.messageQueue.shift();
      console.warn(`[WEBSOCKET] Queue full, removed message: ${removed?.type}`);
    }

    this.messageQueue.push(message);
    console.log(`[WEBSOCKET] Message queued: ${message.type} (queue size: ${this.messageQueue.length})`);
  }

  private async processMessageQueue(): Promise<void> {
    if (this.messageQueue.length === 0 || !this.isConnected()) {
      return;
    }

    console.log(`[WEBSOCKET] Processing ${this.messageQueue.length} queued messages`);

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messages) {
      try {
        await this.sendQueuedMessage(message);
      } catch (error) {
        console.error(`[WEBSOCKET] Failed to send queued message: ${message.type}`);
        // 重新加入队列（但限制重试次数）
        if (!message.data._retryCount || message.data._retryCount < 3) {
          message.data._retryCount = (message.data._retryCount || 0) + 1;
          this.addToQueue(message);
        }
      }
    }
  }

  // 业务层心跳（用于在线状态管理）
  private startHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    // 发送业务心跳给OnlineStatusService
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.socket!.emit('client:heartbeat');
      }
    }, this.heartbeatIntervalMs);
    
    console.log(`[WEBSOCKET] Business heartbeat started (${this.heartbeatIntervalMs}ms interval)`);
  }

  private stopHeartbeat(): void {
    // Socket.IO 自动处理
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WEBSOCKET] Maximum reconnection attempts reached');
      this.emit('max-reconnects-reached');
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnectAttempts = this.reconnectAttempts;

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    
    console.log(`[WEBSOCKET] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      if (this.shouldReconnect && !this.isConnected()) {
        console.log(`[WEBSOCKET] Reconnect attempt ${this.reconnectAttempts}`);
        this.connect(this.websocketUrl).catch(error => {
          console.error('[WEBSOCKET] Reconnect failed:', error);
        });
      }
    }, delay);
  }

  private handleConnectionError(error: any): void {
    console.error('[WEBSOCKET] Connection error:', error);
    this.emit('error', error);
  }

  // Socket.IO 在连接时自动认证（通过auth选项）
  private sendAuthMessage(): void {
    console.log('[WEBSOCKET] Socket.IO authentication handled during connection');
  }

  private handleAuthResponse(data: any): void {
    if (data.success) {
      console.log('[WEBSOCKET] Authentication successful');
      this.emit('authenticated', data);
    } else {
      console.error('[WEBSOCKET] Authentication failed:', data.error);
      this.emit('authentication-failed', data.error);
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async send(message: any): Promise<void> {
    if (!this.isConnected()) {
      // 添加到消息队列
      const queuedMessage = {
        type: 'user-message',
        data: message,
        timestamp: new Date().toISOString(),
        messageId: this.generateMessageId()
      };
      this.messageQueue.push(queuedMessage);
      if (this.messageQueue.length > this.maxQueueSize) {
        this.messageQueue.shift(); // 移除最旧的消息
      }
      console.warn('[WEBSOCKET] Message queued - not connected');
      return;
    }

    try {
      const wrappedMessage = {
        type: 'user-message',
        data: message,
        timestamp: new Date().toISOString(),
        messageId: this.generateMessageId()
      };

      // 使用Socket.IO发送用户消息
      this.socket!.emit('user_message', message);
      this.stats.messagesSent++;
      console.log('[WEBSOCKET] Socket.IO user message sent');
    } catch (error: any) {
      console.error('[WEBSOCKET] Failed to send message:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        code: error?.code
      });
      throw error;
    }
  }

  getConnectionState(): 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' {
    if (this.isConnected()) {
      return 'connected';
    } else if (this.isConnecting) {
      return 'connecting';
    } else if (this.reconnectAttempts > 0 && this.shouldReconnect) {
      return 'reconnecting';
    } else {
      return 'disconnected';
    }
  }

  // 清理资源
  cleanup(): void {
    this.shouldReconnect = false;
    this.disconnect();
    this.removeAllListeners();
    console.log('[WEBSOCKET] Service cleanup completed');
  }

  // 健康检查
  healthCheck(): {
    healthy: boolean;
    details: {
      isConnected: boolean;
      isConnecting: boolean;
      queueSize: number;
      reconnectAttempts: number;
      lastMessage?: Date;
    };
  } {
    return {
      healthy: this.isConnected(),
      details: {
        isConnected: this.isConnected(),
        isConnecting: this.isConnecting,
        queueSize: this.messageQueue.length,
        reconnectAttempts: this.reconnectAttempts,
        lastMessage: this.stats.lastMessageAt
      }
    };
  }

  /**
   * 处理配置更新事件
   */
  private async handleConfigUpdate(updatedConfig: any): Promise<void> {
    try {
      // 检查是否是与WebSocket相关的配置变更
      const isWebSocketConfigChanged = 
        updatedConfig.hasOwnProperty('serverUrl') || 
        updatedConfig.hasOwnProperty('websocketUrl');

      if (!isWebSocketConfigChanged) {
        return; // 非WebSocket相关配置，无需处理
      }

      console.log('[WEBSOCKET] Configuration updated, checking for URL changes...');
      
      // 构建新的WebSocket URL
      const newWebSocketUrl = this.buildWebSocketUrl();
      
      // 检查URL是否真的发生了变化
      if (this.websocketUrl === newWebSocketUrl) {
        console.log('[WEBSOCKET] WebSocket URL unchanged, no action needed');
        return;
      }

      console.log('[WEBSOCKET] WebSocket URL changed:', {
        old: this.websocketUrl,
        new: newWebSocketUrl
      });

      // 如果当前已连接，先断开
      if (this.isConnected()) {
        console.log('[WEBSOCKET] Disconnecting current connection...');
        await this.disconnect();
      }

      // 等待一小段时间确保断开完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 使用新URL重新连接
      console.log('[WEBSOCKET] Reconnecting with new URL...');
      await this.connect(newWebSocketUrl);
      
      console.log('[WEBSOCKET] Successfully reconnected with new configuration');

    } catch (error: any) {
      console.error('[WEBSOCKET] Error handling config update:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack,
        code: error?.code
      });

      // 如果重连失败，尝试恢复到之前的状态
      if (!this.isConnected() && this.shouldReconnect) {
        console.log('[WEBSOCKET] Attempting to restore connection...');
        setTimeout(() => {
          this.connect().catch(retryError => {
            console.error('[WEBSOCKET] Failed to restore connection:', {
              message: retryError?.message || 'Unknown error',
              stack: retryError?.stack
            });
          });
        }, 2000);
      }
    }
  }

  /**
   * 手动触发重连（用于系统唤醒等场景）
   */
  async reconnect(): Promise<void> {
    console.log('[WEBSOCKET] Manual reconnection triggered');

    if (this.socket?.connected) {
      console.log('[WEBSOCKET] Already connected, no need to reconnect');
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await this.connect();
  }

  /**
   * 手动重新连接（供外部调用）
   */
  async reconnectWithNewConfig(): Promise<void> {
    await this.handleConfigUpdate({ serverUrl: true }); // 触发重连
  }
}