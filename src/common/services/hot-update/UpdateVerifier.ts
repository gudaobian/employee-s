import * as crypto from 'crypto';
import * as fs from 'fs';
import * as log from 'electron-log';

/**
 * 更新验证器
 *
 * 负责SHA512校验、版本号验证和比较
 */
export class UpdateVerifier {
  /**
   * 计算文件SHA512
   */
  async calculateSHA512(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 验证文件完整性
   */
  async verify(filePath: string, expectedSha512: string): Promise<boolean> {
    try {
      const actualSha512 = await this.calculateSHA512(filePath);
      const isValid = actualSha512 === expectedSha512;

      if (!isValid) {
        log.error('[UpdateVerifier] SHA512校验失败');
        log.error(`[UpdateVerifier] 期望: ${expectedSha512}`);
        log.error(`[UpdateVerifier] 实际: ${actualSha512}`);
      }

      return isValid;
    } catch (error) {
      log.error('[UpdateVerifier] 校验过程出错:', error);
      return false;
    }
  }

  /**
   * 验证版本号格式
   */
  isValidVersion(version: string): boolean {
    // 语义化版本格式: x.y.z
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
  }

  /**
   * 比较版本号
   * @returns >0 if v1 > v2, 0 if equal, <0 if v1 < v2
   */
  compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 !== num2) return num1 - num2;
    }

    return 0;
  }

  /**
   * 检查是否需要更新
   */
  needsUpdate(currentVersion: string, targetVersion: string): boolean {
    return this.compareVersions(currentVersion, targetVersion) < 0;
  }

  /**
   * 获取版本差异描述
   */
  getVersionDiff(fromVersion: string, toVersion: string): {
    major: boolean;
    minor: boolean;
    patch: boolean;
  } {
    const from = fromVersion.split('.').map(Number);
    const to = toVersion.split('.').map(Number);

    return {
      major: from[0] !== to[0],
      minor: from[1] !== to[1],
      patch: from[2] !== to[2]
    };
  }
}
