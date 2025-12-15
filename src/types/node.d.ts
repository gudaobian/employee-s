/**
 * Node.js全局类型声明
 * 解决TypeScript编译时无法找到Node.js内置模块的问题
 */

// Node.js 内置模块的基本类型声明
declare module 'fs' {
  export function readFileSync(path: string, options?: any): any;
  export function writeFileSync(path: string, data: any, options?: any): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: any): void;
  export function statSync(path: string): any;
  export function readFile(path: string, callback: (err: any, data: any) => void): void;
  export function writeFile(path: string, data: any, callback: (err: any) => void): void;
  export function readlinkSync(path: string): string;
  export const constants: any;
  export const promises: {
    readFile(path: string, options?: any): Promise<any>;
    writeFile(path: string, data: any, options?: any): Promise<void>;
    access(path: string, mode?: number): Promise<void>;
    stat(path: string): Promise<any>;
    mkdir(path: string, options?: any): Promise<void>;
    unlink(path: string): Promise<void>;
    appendFile(path: string, data: any, options?: any): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    rmdir(path: string, options?: any): Promise<void>;
    copyFile(src: string, dest: string): Promise<void>;
    readdir(path: string, options?: any): Promise<string[]>;
    open(path: string, flags?: string | number, mode?: any): Promise<{ close(): Promise<void>; read: any; write: any }>;
  };
}

declare module 'path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export const sep: string;
}

declare module 'os' {
  export function platform(): string;
  export function hostname(): string;
  export function userInfo(): any;
  export function arch(): string;
  export function release(): string;
  export function cpus(): any[];
  export function totalmem(): number;
  export function freemem(): number;
  export function networkInterfaces(): any;
  export function homedir(): string;
  export function tmpdir(): string;
  export function type(): string;
  export const EOL: string;
}

declare module 'crypto' {
  export function randomBytes(size: number): Buffer;
  export function createHash(algorithm: string): any;
  export function createHmac(algorithm: string, key: string | Buffer): any;
  export function createCipher(algorithm: string, password: string): any;
  export function createDecipher(algorithm: string, password: string): any;
  export function randomUUID(): string;
}

declare module 'events' {
  class EventEmitter {
    constructor();
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    listeners(event: string | symbol): Function[];
    listenerCount(event: string | symbol): number;
    eventNames(): (string | symbol)[];
  }
  export = EventEmitter;
  export { EventEmitter };
}

declare module 'url' {
  export class URL {
    constructor(input: string, base?: string);
    href: string;
    origin: string;
    protocol: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    searchParams: URLSearchParams;
    hash: string;
  }
  
  export class URLSearchParams {
    constructor(init?: string | string[][] | Record<string, string>);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    toString(): string;
  }

  export function parse(urlString: string): any;
  export function format(urlObject: any): string;
}

declare module 'util' {
  export function promisify(fn: Function): Function;
  export function format(f: any, ...args: any[]): string;
  export function inspect(object: any, options?: any): string;
}

declare module 'querystring' {
  export function stringify(obj: any, sep?: string, eq?: string): string;
  export function parse(str: string, sep?: string, eq?: string): any;
}

declare module 'http' {
  export function request(options: any, callback?: (res: any) => void): any;
  export function get(options: any, callback?: (res: any) => void): any;
  export class IncomingMessage {
    statusCode?: number;
    statusMessage?: string;
    headers: any;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}

declare module 'https' {
  export function request(options: any, callback?: (res: any) => void): any;
  export function get(options: any, callback?: (res: any) => void): any;
}

declare module 'child_process' {
  export function spawn(command: string, args?: string[], options?: any): any;
  export function exec(command: string, options?: any, callback?: (error: any, stdout: any, stderr: any) => void): any;
  export function execSync(command: string, options?: any): any;
  export function fork(modulePath: string, args?: string[], options?: any): any;
}

// Node.js全局对象
declare var process: {
  platform: string;
  arch: string;
  version: string;
  env: { [key: string]: string | undefined };
  argv: string[];
  cwd(): string;
  exit(code?: number): void;
  nextTick(callback: Function): void;
  pid: number;
  execPath: string;
  stdin: any;
  stdout: any;
  stderr: any;
  on(event: string, listener: (...args: any[]) => void): void;
  cpuUsage(): { user: number; system: number };
  memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
  uptime(): number;
  versions: {
    node: string;
    v8: string;
    uv: string;
    zlib: string;
    ares: string;
    modules: string;
    nghttp2: string;
    napi: string;
    llhttp: string;
    openssl: string;
    cldr: string;
    icu: string;
    tz: string;
    unicode: string;
    [key: string]: string;
  };
};

declare var Buffer: {
  new (data: any, encoding?: string): Buffer;
  from(data: any, encoding?: string): Buffer;
  alloc(size: number, fill?: any, encoding?: string): Buffer;
  allocUnsafe(size: number): Buffer;
  concat(list: Buffer[], totalLength?: number): Buffer;
  isBuffer(obj: any): obj is Buffer;
};

declare var global: any;
declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
};

declare var require: {
  (id: string): any;
  resolve(id: string): string;
  main?: any;
};

// setTimeout等全局函数
declare function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
declare function clearTimeout(timeoutId: any): void;
declare function setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
declare function clearInterval(intervalId: any): void;
declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): any;
declare function clearImmediate(immediateId: any): void;

// URL构造函数  
declare var URL: any;

// Buffer 接口
declare interface Buffer {
  length: number;
  toString(encoding?: string, start?: number, end?: number): string;
  toJSON(): { type: 'Buffer'; data: number[] };
  slice(start?: number, end?: number): Buffer;
  copy(target: Buffer, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
  fill(value: any, offset?: number, end?: number): Buffer;
  indexOf(value: any, byteOffset?: number, encoding?: string): number;
  includes(value: any, byteOffset?: number, encoding?: string): boolean;
  readUInt8(offset: number): number;
  readUInt16LE(offset: number): number;
  readUInt32LE(offset: number): number;
  writeUInt8(value: number, offset: number): number;
  writeUInt16LE(value: number, offset: number): number;
  writeUInt32LE(value: number, offset: number): number;
}

// NodeJS 命名空间 (简化版)
declare namespace NodeJS {
  interface Process {
    platform: string;
    arch: string;
    version: string;
    env: { [key: string]: string | undefined };
    argv: string[];
    cwd(): string;
    exit(code?: number): void;
    nextTick(callback: Function): void;
    pid: number;
    execPath: string;
    stdin: any;
    stdout: any;
    stderr: any;
    on(event: string, listener: (...args: any[]) => void): void;
    cpuUsage(): CpuUsage;
    memoryUsage(): MemoryUsage;
    uptime(): number;
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

  interface CpuUsage {
    user: number;
    system: number;
  }

  interface MemoryUsage {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  }

  type Platform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
}

// 在全局范围内重新声明 AuthResult 类型
type AuthResult = {
  token: string;
  expiresAt: number;
  deviceId: string;
  isAuthenticated: boolean;
};

declare interface NodeRequire {
  (id: string): any;
  resolve(id: string): string;
  main?: any;
}

// 全局的module对象
declare var module: {
  exports: any;
  require: NodeRequire;
  id: string;
  filename: string;
  loaded: boolean;
  parent?: any;
  children: any[];
  paths: string[];
};

// __dirname 和 __filename 全局变量
declare var __dirname: string;
declare var __filename: string;

// Electron module
declare module 'electron' {
  export interface BrowserWindow {
    new (options?: any): any;
    loadFile(filePath: string): Promise<void>;
    loadURL(url: string): Promise<void>;
    webContents: any;
    show(): void;
    hide(): void;
    close(): void;
    minimize(): void;
    maximize(): void;
    isMinimized(): boolean;
    isMaximized(): boolean;
    setMenuBarVisibility(visible: boolean): void;
    on(event: string, listener: (...args: any[]) => void): void;
    once(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
  }

  export interface App {
    whenReady(): Promise<void>;
    quit(): void;
    on(event: string, listener: (...args: any[]) => void): void;
    once(event: string, listener: (...args: any[]) => void): void;
    dock?: {
      hide(): void;
    };
    getPath(name: string): string;
  }

  export interface Tray {
    new (image: string): any;
    setToolTip(toolTip: string): void;
    setContextMenu(menu: any): void;
    on(event: string, listener: (...args: any[]) => void): void;
  }

  export interface Menu {
    buildFromTemplate(template: any[]): any;
    setApplicationMenu(menu: any): void;
  }

  export interface MenuItem {
    new (options: any): any;
  }

  export interface IpcMain {
    handle(channel: string, listener: (event: any, ...args: any[]) => any): void;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    once(channel: string, listener: (event: any, ...args: any[]) => void): void;
  }

  export interface IpcRenderer {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, ...args: any[]): void;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
  }

  export interface ContextBridge {
    exposeInMainWorld(apiKey: string, api: any): void;
  }

  export const app: App;
  export const BrowserWindow: any;
  export const Menu: any;
  export const MenuItem: any;
  export const Tray: any;
  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;
  export const contextBridge: ContextBridge;

  export namespace Electron {
    interface BrowserWindow {
      new (options?: any): any;
      loadFile(filePath: string): Promise<void>;
      loadURL(url: string): Promise<void>;
      webContents: any;
      show(): void;
      hide(): void;
      close(): void;
      minimize(): void;
      maximize(): void;
      isMinimized(): boolean;
      isMaximized(): boolean;
      setMenuBarVisibility(visible: boolean): void;
      on(event: string, listener: (...args: any[]) => void): void;
      once(event: string, listener: (...args: any[]) => void): void;
      off(event: string, listener: (...args: any[]) => void): void;
    }
  }
}