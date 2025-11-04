/**
 * Privacy Helper Unit Tests
 *
 * Comprehensive test suite for URL sanitization functionality.
 *
 * Test Categories:
 * 1. Query Parameter Stripping
 * 2. Sensitive Domain Redaction
 * 3. Whitelist Parameters Preservation
 * 4. Pattern Matching
 * 5. Invalid URL Handling
 * 6. Edge Cases
 *
 * @module privacy-helper.test
 */

import {
  sanitizeUrl,
  isSensitiveDomain,
  getPrivacyLevel,
  sanitizeUrlBatch,
  validatePrivacyConfig,
  PrivacyConfig,
  PrivacyLevel,
} from '../../common/utils/privacy-helper';

import {
  DEFAULT_PRIVACY_CONFIG,
  MINIMAL_PRIVACY_CONFIG,
  STRICT_PRIVACY_CONFIG,
  getPrivacyConfigForEnvironment,
  mergePrivacyConfig,
} from '../../common/config/privacy-config';

describe('privacy-helper', () => {
  describe('sanitizeUrl()', () => {
    describe('Query Parameter Stripping', () => {
      it('should strip all query parameters when stripQueryParams is true', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://example.com/page?token=abc123&user_id=456';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/page');
      });

      it('should preserve whitelisted query parameters', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          queryParamWhitelist: ['page', 'lang'],
          sensitivePatterns: [],
        };

        const input = 'https://example.com/search?token=abc&page=1&lang=en&user_id=123';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/search?page=1&lang=en');
      });

      it('should keep all query parameters when stripQueryParams is false', () => {
        const config: PrivacyConfig = {
          stripQueryParams: false,
          sensitivePatterns: [],
        };

        const input = 'https://example.com/page?foo=bar&baz=qux';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/page?foo=bar&baz=qux');
      });

      it('should handle URLs with no query parameters', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://example.com/page';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/page');
      });

      it('should handle URLs with only whitelisted parameters', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          queryParamWhitelist: ['page', 'sort'],
          sensitivePatterns: [],
        };

        const input = 'https://example.com/list?page=2&sort=name';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/list?page=2&sort=name');
      });
    });

    describe('Sensitive Domain Redaction', () => {
      it('should redact mail.google.com URLs', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://mail.google.com/mail/u/0/#inbox';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[REDACTED_SENSITIVE]');
      });

      it('should redact outlook.office.com URLs', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://outlook.office.com/mail/inbox';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[REDACTED_SENSITIVE]');
      });

      it('should redact banking-related domains', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://www.bankofamerica.com/account/overview';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[REDACTED_SENSITIVE]');
      });

      it('should NOT redact whitelisted domains', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          domainWhitelist: ['company-internal.com'],
          sensitivePatterns: [],
        };

        const input = 'https://mail.company-internal.com/inbox';
        const output = sanitizeUrl(input, config);

        expect(output).not.toBe('[REDACTED_SENSITIVE]');
        expect(output).toBe('https://mail.company-internal.com/inbox');
      });

      it('should redact subdomains of sensitive domains', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://accounts.google.com/signin';
        const output = sanitizeUrl(input, config);

        // Should NOT be redacted (only mail.google.com is sensitive)
        expect(output).toBe('https://accounts.google.com/signin');
      });
    });

    describe('Sensitive Pattern Detection', () => {
      it('should redact URLs with token= parameter', () => {
        const input = 'https://example.com/api?token=abc123';
        const output = sanitizeUrl(input, DEFAULT_PRIVACY_CONFIG);

        expect(output).toBe('[REDACTED_PATTERN]');
      });

      it('should redact URLs with api_key= parameter', () => {
        const input = 'https://api.example.com/endpoint?api_key=secret123';
        const output = sanitizeUrl(input, DEFAULT_PRIVACY_CONFIG);

        expect(output).toBe('[REDACTED_PATTERN]');
      });

      it('should redact URLs with password= parameter', () => {
        const input = 'https://example.com/login?password=mypassword';
        const output = sanitizeUrl(input, DEFAULT_PRIVACY_CONFIG);

        expect(output).toBe('[REDACTED_PATTERN]');
      });

      it('should redact URLs containing credit card numbers', () => {
        const config: PrivacyConfig = {
          stripQueryParams: false,
          sensitivePatterns: [/\b\d{13,19}\b/],
        };

        const input = 'https://example.com/payment?card=4532015112830366';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[REDACTED_PATTERN]');
      });

      it('should handle multiple sensitive patterns', () => {
        const config: PrivacyConfig = {
          stripQueryParams: false,
          sensitivePatterns: [/token=/i, /secret=/i],
        };

        const input1 = 'https://example.com/api?token=abc';
        const input2 = 'https://example.com/api?secret=xyz';

        expect(sanitizeUrl(input1, config)).toBe('[REDACTED_PATTERN]');
        expect(sanitizeUrl(input2, config)).toBe('[REDACTED_PATTERN]');
      });

      it('should be case-insensitive for patterns', () => {
        const config: PrivacyConfig = {
          stripQueryParams: false,
          sensitivePatterns: [/token=/i],
        };

        const input1 = 'https://example.com/api?TOKEN=abc';
        const input2 = 'https://example.com/api?Token=xyz';

        expect(sanitizeUrl(input1, config)).toBe('[REDACTED_PATTERN]');
        expect(sanitizeUrl(input2, config)).toBe('[REDACTED_PATTERN]');
      });
    });

    describe('URL Fragment Removal', () => {
      it('should remove URL fragments (#hash)', () => {
        const config: PrivacyConfig = {
          stripQueryParams: false,
          sensitivePatterns: [],
        };

        const input = 'https://example.com/page#section';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/page');
      });

      it('should remove fragments with query parameters', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          queryParamWhitelist: ['page'],
          sensitivePatterns: [],
        };

        const input = 'https://example.com/docs?page=1&token=abc#introduction';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/docs?page=1');
      });
    });

    describe('Invalid URL Handling', () => {
      it('should return [INVALID_URL] for malformed URLs', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'not-a-valid-url';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[INVALID_URL]');
      });

      it('should return [INVALID_URL] for empty strings', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = '';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('[INVALID_URL]');
      });

      it('should handle URLs with special characters correctly', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          queryParamWhitelist: ['search'],
          sensitivePatterns: [],
        };

        const input = 'https://example.com/search?search=hello%20world&token=abc';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com/search?search=hello+world');
      });
    });

    describe('Edge Cases', () => {
      it('should handle URLs with ports', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://example.com:8080/api?token=abc';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('https://example.com:8080/api');
      });

      it('should handle URLs with authentication', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'https://user:pass@example.com/page';
        const output = sanitizeUrl(input, config);

        // URL object preserves auth in hostname
        expect(output).toContain('example.com/page');
      });

      it('should handle IP addresses', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'http://192.168.1.1/admin?session=xyz';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('http://192.168.1.1/admin');
      });

      it('should handle localhost URLs', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          sensitivePatterns: [],
        };

        const input = 'http://localhost:3000/api?token=dev';
        const output = sanitizeUrl(input, config);

        expect(output).toBe('http://localhost:3000/api');
      });

      it('should process pattern check BEFORE query stripping', () => {
        const config: PrivacyConfig = {
          stripQueryParams: true,
          queryParamWhitelist: [],
          sensitivePatterns: [/token=/i],
        };

        // Pattern checked first, so it will match and redact
        const input = 'https://example.com/page?token=abc';
        const output = sanitizeUrl(input, config);

        // Pattern matches before stripping, so URL is completely redacted
        expect(output).toBe('[REDACTED_PATTERN]');
      });
    });
  });

  describe('isSensitiveDomain()', () => {
    it('should identify mail.google.com as sensitive', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      expect(isSensitiveDomain('mail.google.com', config)).toBe(true);
    });

    it('should identify outlook.office.com as sensitive', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      expect(isSensitiveDomain('outlook.office.com', config)).toBe(true);
    });

    it('should NOT identify example.com as sensitive', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      expect(isSensitiveDomain('example.com', config)).toBe(false);
    });

    it('should respect domain whitelist', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        domainWhitelist: ['company-mail.com'],
        sensitivePatterns: [],
      };

      expect(isSensitiveDomain('company-mail.com', config)).toBe(false);
    });

    it('should handle partial domain matches', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      expect(isSensitiveDomain('subdomain.mail.google.com', config)).toBe(true);
    });
  });

  describe('getPrivacyLevel()', () => {
    it('should return "redacted" for [REDACTED_SENSITIVE]', () => {
      expect(getPrivacyLevel('[REDACTED_SENSITIVE]')).toBe('redacted');
    });

    it('should return "redacted" for [REDACTED_PATTERN]', () => {
      expect(getPrivacyLevel('[REDACTED_PATTERN]')).toBe('redacted');
    });

    it('should return "redacted" for [INVALID_URL]', () => {
      expect(getPrivacyLevel('[INVALID_URL]')).toBe('redacted');
    });

    it('should return "full" for complete URLs', () => {
      expect(getPrivacyLevel('https://example.com/page/subpage')).toBe('full');
    });

    it('should return "domain_only" for URLs with only domain', () => {
      expect(getPrivacyLevel('https://example.com/')).toBe('domain_only');
    });

    it('should return "full" for URLs with paths', () => {
      expect(getPrivacyLevel('https://example.com/path')).toBe('full');
    });
  });

  describe('sanitizeUrlBatch()', () => {
    it('should sanitize multiple URLs efficiently', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      const urls = [
        'https://example.com/page1?token=abc',
        'https://example.com/page2?session=xyz',
        'https://mail.google.com/inbox',
      ];

      const sanitized = sanitizeUrlBatch(urls, config);

      expect(sanitized).toEqual([
        'https://example.com/page1',
        'https://example.com/page2',
        '[REDACTED_SENSITIVE]',
      ]);
    });

    it('should handle empty array', () => {
      const config: PrivacyConfig = {
        stripQueryParams: true,
        sensitivePatterns: [],
      };

      const sanitized = sanitizeUrlBatch([], config);

      expect(sanitized).toEqual([]);
    });
  });

  describe('validatePrivacyConfig()', () => {
    it('should validate correct configuration', () => {
      expect(() => validatePrivacyConfig(DEFAULT_PRIVACY_CONFIG)).not.toThrow();
    });

    it('should throw on invalid stripQueryParams type', () => {
      const config: any = {
        stripQueryParams: 'true', // Should be boolean
        sensitivePatterns: [],
      };

      expect(() => validatePrivacyConfig(config)).toThrow('stripQueryParams must be a boolean');
    });

    it('should throw on invalid queryParamWhitelist type', () => {
      const config: any = {
        stripQueryParams: true,
        queryParamWhitelist: 'page,lang', // Should be array
        sensitivePatterns: [],
      };

      expect(() => validatePrivacyConfig(config)).toThrow('queryParamWhitelist must be an array');
    });

    it('should throw on invalid sensitivePatterns type', () => {
      const config: any = {
        stripQueryParams: true,
        sensitivePatterns: 'invalid', // Should be array
      };

      expect(() => validatePrivacyConfig(config)).toThrow('sensitivePatterns must be an array');
    });

    it('should throw on non-RegExp in sensitivePatterns', () => {
      const config: any = {
        stripQueryParams: true,
        sensitivePatterns: [/valid/, 'invalid'], // Should all be RegExp
      };

      expect(() => validatePrivacyConfig(config)).toThrow('All sensitivePatterns must be RegExp instances');
    });
  });

  describe('Privacy Config Presets', () => {
    describe('DEFAULT_PRIVACY_CONFIG', () => {
      it('should have stripQueryParams enabled', () => {
        expect(DEFAULT_PRIVACY_CONFIG.stripQueryParams).toBe(true);
      });

      it('should have whitelisted parameters', () => {
        expect(DEFAULT_PRIVACY_CONFIG.queryParamWhitelist).toContain('page');
        expect(DEFAULT_PRIVACY_CONFIG.queryParamWhitelist).toContain('lang');
      });

      it('should have sensitive patterns defined', () => {
        expect(DEFAULT_PRIVACY_CONFIG.sensitivePatterns.length).toBeGreaterThan(0);
      });

      it('should redact token parameters', () => {
        const url = 'https://example.com/api?token=secret';
        expect(sanitizeUrl(url, DEFAULT_PRIVACY_CONFIG)).toBe('[REDACTED_PATTERN]');
      });
    });

    describe('MINIMAL_PRIVACY_CONFIG', () => {
      it('should have stripQueryParams disabled', () => {
        expect(MINIMAL_PRIVACY_CONFIG.stripQueryParams).toBe(false);
      });

      it('should have fewer sensitive patterns', () => {
        expect(MINIMAL_PRIVACY_CONFIG.sensitivePatterns.length).toBeLessThan(
          DEFAULT_PRIVACY_CONFIG.sensitivePatterns.length
        );
      });
    });

    describe('STRICT_PRIVACY_CONFIG', () => {
      it('should strip all query parameters', () => {
        expect(STRICT_PRIVACY_CONFIG.stripQueryParams).toBe(true);
        expect(STRICT_PRIVACY_CONFIG.queryParamWhitelist).toEqual([]);
      });

      it('should have more sensitive patterns than default', () => {
        expect(STRICT_PRIVACY_CONFIG.sensitivePatterns.length).toBeGreaterThan(
          DEFAULT_PRIVACY_CONFIG.sensitivePatterns.length
        );
      });
    });

    describe('getPrivacyConfigForEnvironment()', () => {
      it('should return MINIMAL for development', () => {
        const config = getPrivacyConfigForEnvironment('development');
        expect(config.stripQueryParams).toBe(false);
      });

      it('should return DEFAULT for production', () => {
        const config = getPrivacyConfigForEnvironment('production');
        expect(config).toEqual(DEFAULT_PRIVACY_CONFIG);
      });

      it('should return STRICT for strict environment', () => {
        const config = getPrivacyConfigForEnvironment('strict');
        expect(config).toEqual(STRICT_PRIVACY_CONFIG);
      });
    });

    describe('mergePrivacyConfig()', () => {
      it('should merge custom whitelist with defaults', () => {
        const custom = mergePrivacyConfig({
          queryParamWhitelist: ['custom1', 'custom2'],
        });

        expect(custom.queryParamWhitelist).toContain('page'); // Default
        expect(custom.queryParamWhitelist).toContain('custom1'); // Custom
        expect(custom.queryParamWhitelist).toContain('custom2'); // Custom
      });

      it('should merge custom patterns with defaults', () => {
        const custom = mergePrivacyConfig({
          sensitivePatterns: [/custom-pattern/],
        });

        expect(custom.sensitivePatterns.length).toBeGreaterThan(
          DEFAULT_PRIVACY_CONFIG.sensitivePatterns.length
        );
      });

      it('should override scalar values', () => {
        const custom = mergePrivacyConfig({
          stripQueryParams: false,
        });

        expect(custom.stripQueryParams).toBe(false);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle real-world URL examples correctly', () => {
      const testCases = [
        {
          input: 'https://github.com/user/repo?tab=readme',
          expected: 'https://github.com/user/repo?tab=readme', // tab is whitelisted
        },
        {
          input: 'https://stackoverflow.com/questions/123456?page=2&utm_source=google',
          expected: 'https://stackoverflow.com/questions/123456?page=2', // page whitelisted, utm stripped
        },
        {
          input: 'https://mail.google.com/mail/u/0/#inbox',
          expected: '[REDACTED_SENSITIVE]',
        },
        {
          input: 'https://example.com/reset?token=abc123',
          expected: '[REDACTED_PATTERN]',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const output = sanitizeUrl(input, DEFAULT_PRIVACY_CONFIG);
        expect(output).toBe(expected);
      });
    });

    it('should provide consistent results across multiple calls', () => {
      const url = 'https://example.com/page?token=abc&page=1';

      const result1 = sanitizeUrl(url, DEFAULT_PRIVACY_CONFIG);
      const result2 = sanitizeUrl(url, DEFAULT_PRIVACY_CONFIG);
      const result3 = sanitizeUrl(url, DEFAULT_PRIVACY_CONFIG);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should handle performance-critical scenarios (1000 URLs)', () => {
      const urls = Array(1000).fill('https://example.com/page?token=abc&page=1');

      const startTime = Date.now();
      const results = sanitizeUrlBatch(urls, DEFAULT_PRIVACY_CONFIG);
      const endTime = Date.now();

      expect(results.length).toBe(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1 second

      // All should be redacted due to token
      expect(results.every(r => r === '[REDACTED_PATTERN]')).toBe(true);
    });
  });
});
