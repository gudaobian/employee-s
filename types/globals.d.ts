/**
 * 全局类型声明
 * 覆盖Node.js和项目特定的全局类型
 */

/// <reference path="./node.d.ts" />

import { EventEmitter } from 'events';

// 全局引入自定义事件发射器
declare global {
  // 导入自定义类型
  type AuthResult = import('../common/interfaces/service-interfaces').AuthResult;
  type MonitoringData = import('../common/interfaces/service-interfaces').MonitoringData;

  // Node.js 全局变量增强
  var process: NodeJS.Process;
  var Buffer: BufferConstructor;
  var global: NodeJS.Global;
  var console: Console;
  var require: NodeRequire;

  // 全局类型
  interface BufferConstructor {
    new(data: any, encoding?: string): Buffer;
    from(data: any, encoding?: string): Buffer;
    alloc(size: number, fill?: any, encoding?: string): Buffer;
    allocUnsafe(size: number): Buffer;
    concat(list: Buffer[], totalLength?: number): Buffer;
    isBuffer(obj: any): obj is Buffer;
  }

  interface Buffer {
    length: number;
    toString(encoding?: string, start?: number, end?: number): string;
    toJSON(): { type: 'Buffer'; data: number[] };
    slice(start?: number, end?: number): Buffer;
    copy(target: Buffer, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
  }

  // Node.js 命名空间
  namespace NodeJS {
    interface Process {
      platform: string;
      arch: string;
      version: string;
      env: { [key: string]: string | undefined };
      argv: string[];
      cwd(): string;
      exit(code?: number): void;
      nextTick(callback: Function): void;
    }

    interface Global {
      [key: string]: any;
    }

    interface Timeout {
      ref(): void;
      unref(): void;
    }

    interface Immediate {
      ref(): void;
      unref(): void;
    }
  }

  interface NodeRequire {
    (id: string): any;
    resolve(id: string): string;
  }

  // 全局函数
  function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
  function clearTimeout(timeoutId: NodeJS.Timeout): void;
  function setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
  function clearInterval(intervalId: NodeJS.Timeout): void;
  function setImmediate(callback: (...args: any[]) => void, ...args: any[]): NodeJS.Immediate;
  function clearImmediate(immediateId: NodeJS.Immediate): void;

  // URL 构造函数
  var URL: typeof import('url').URL;
}

export {};