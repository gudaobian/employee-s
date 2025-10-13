/**
 * HTTP客户端 - 重构版本
 * 统一的HTTP请求处理
 */

interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  success: boolean;
}

interface HttpRequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

interface HttpClientConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
  getAuthToken?: () => string | undefined;
}

export class HttpClient {
  private config: Required<HttpClientConfig>;

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      baseURL: '',
      timeout: 10000,
      headers: {},
      retries: 2,
      retryDelay: 1000,
      getAuthToken: () => undefined,
      ...config
    };
  }

  async get<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: 'GET' });
  }

  async post<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: 'POST', body: data });
  }

  async put<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: 'PUT', body: data });
  }

  async delete<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: 'DELETE' });
  }

  async patch<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: 'PATCH', body: data });
  }

  private async request<T = any>(url: string, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
    const fullUrl = this.buildFullUrl(url);
    const requestConfig = this.buildRequestConfig(config);
    
    let lastError: Error | undefined;
    const maxAttempts = (config.retries ?? this.config.retries) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.executeRequest<T>(fullUrl, requestConfig);
        return response;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxAttempts && this.isRetryableError(error as Error)) {
          const delay = (config.retryDelay ?? this.config.retryDelay) * attempt;
          await this.sleep(delay);
          continue;
        }
        
        break;
      }
    }

    throw lastError || new Error('Request failed');
  }

  private buildFullUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    const baseURL = this.config.baseURL.endsWith('/') 
      ? this.config.baseURL.slice(0, -1) 
      : this.config.baseURL;
    
    const path = url.startsWith('/') ? url : `/${url}`;
    
    return `${baseURL}${path}`;
  }

  private buildRequestConfig(config: HttpRequestConfig): HttpRequestConfig & { headers: Record<string, string> } {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Employee-Monitor-Client/1.0',
      ...this.config.headers,
      ...config.headers
    };

    // 添加认证token
    const token = this.config.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return {
      method: 'GET',
      timeout: this.config.timeout,
      ...config,
      headers
    };
  }

  private async executeRequest<T>(url: string, config: HttpRequestConfig & { headers: Record<string, string> }): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? require('https') : require('http');

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: config.method,
        headers: config.headers,
        timeout: config.timeout
      };

      const req = httpModule.request(requestOptions, (res: any) => {
        let data = '';
        
        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const headers: Record<string, string> = {};
            Object.keys(res.headers).forEach(key => {
              headers[key] = String(res.headers[key]);
            });

            let parsedData: T;
            try {
              parsedData = data ? JSON.parse(data) : null;
            } catch {
              parsedData = data as any;
            }

            const response: HttpResponse<T> = {
              data: parsedData,
              status: res.statusCode,
              statusText: res.statusMessage || 'Unknown',
              headers,
              success: res.statusCode >= 200 && res.statusCode < 300
            };

            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error: any) => {
        reject(this.enhanceError(error, url));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout for ${url}`));
      });

      if (config.timeout) {
        req.setTimeout(config.timeout);
      }

      // 发送请求体
      if (config.body && (config.method === 'POST' || config.method === 'PUT' || config.method === 'PATCH')) {
        const bodyString = typeof config.body === 'string' 
          ? config.body 
          : JSON.stringify(config.body);
        req.write(bodyString);
      }

      req.end();
    });
  }

  private enhanceError(error: any, url: string): Error {
    const message = `Request to ${url} failed: ${error.message}`;
    const enhancedError = new Error(message);
    (enhancedError as any).cause = error;
    return enhancedError;
  }

  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN'
    ];

    return retryableErrors.some(code => 
      error.message.includes(code) || (error as any).code === code
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 更新配置
  updateConfig(updates: Partial<HttpClientConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // 获取当前配置
  getConfig(): HttpClientConfig {
    return { ...this.config };
  }

  // 创建新的客户端实例
  static create(config: HttpClientConfig): HttpClient {
    return new HttpClient(config);
  }
}

// 创建默认实例
export const httpClient = new HttpClient();

export default HttpClient;