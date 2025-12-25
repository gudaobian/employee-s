/**
 * 简单的 EventEmitter 实现（浏览器环境）
 *
 * 用于渲染进程的事件发射器，替代 Node.js 的 events 模块
 */
class EventEmitter {
  constructor() {
    this._events = {};
  }

  /**
   * 注册事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   * @returns {EventEmitter} this
   */
  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }

    if (!this._events[event]) {
      this._events[event] = [];
    }

    this._events[event].push(listener);
    return this;
  }

  /**
   * 注册一次性事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   * @returns {EventEmitter} this
   */
  once(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }

    const onceWrapper = (...args) => {
      listener.apply(this, args);
      this.off(event, onceWrapper);
    };

    onceWrapper.listener = listener;
    this.on(event, onceWrapper);

    return this;
  }

  /**
   * 移除事件监听器
   * @param {string} event - 事件名称
   * @param {Function} listener - 监听器函数
   * @returns {EventEmitter} this
   */
  off(event, listener) {
    if (!this._events[event]) {
      return this;
    }

    if (!listener) {
      // 移除所有监听器
      delete this._events[event];
      return this;
    }

    const listeners = this._events[event];
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i] === listener || listeners[i].listener === listener) {
        listeners.splice(i, 1);
      }
    }

    if (listeners.length === 0) {
      delete this._events[event];
    }

    return this;
  }

  /**
   * 移除事件监听器（别名）
   */
  removeListener(event, listener) {
    return this.off(event, listener);
  }

  /**
   * 移除所有监听器
   * @param {string} event - 事件名称（可选）
   * @returns {EventEmitter} this
   */
  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {...*} args - 传递给监听器的参数
   * @returns {boolean} 是否有监听器被调用
   */
  emit(event, ...args) {
    if (!this._events[event]) {
      return false;
    }

    const listeners = this._events[event].slice(); // 复制数组，防止在回调中修改

    for (const listener of listeners) {
      try {
        listener.apply(this, args);
      } catch (error) {
        console.error(`[EventEmitter] Error in listener for event "${event}":`, error);
      }
    }

    return true;
  }

  /**
   * 获取事件的监听器数量
   * @param {string} event - 事件名称
   * @returns {number} 监听器数量
   */
  listenerCount(event) {
    if (!this._events[event]) {
      return 0;
    }
    return this._events[event].length;
  }

  /**
   * 获取事件的所有监听器
   * @param {string} event - 事件名称
   * @returns {Function[]} 监听器数组
   */
  listeners(event) {
    if (!this._events[event]) {
      return [];
    }
    return this._events[event].slice();
  }

  /**
   * 获取所有事件名称
   * @returns {string[]} 事件名称数组
   */
  eventNames() {
    return Object.keys(this._events);
  }
}

// 导出（ES5 兼容）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventEmitter;
}
