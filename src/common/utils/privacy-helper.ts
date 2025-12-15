/**
 * Privacy Helper - URL Sanitization Utilities
 *
 * Provides privacy-focused URL sanitization to protect sensitive employee data
 * while collecting browser activity information.
 *
 * Key Features:
 * - Query parameter stripping (with whitelist support)
 * - Sensitive domain detection and redaction
 * - Pattern-based sensitive content detection
 * - URL fragment removal
 * - Invalid URL handling
 *
 * @module privacy-helper
 */

import { logger } from './logger';

/**
 * Privacy configuration interface
 */
export interface PrivacyConfig {
  /** Strip all query parameters except whitelisted ones */
  stripQueryParams: boolean;

  /** Whitelist of allowed query parameter names */
  queryParamWhitelist?: string[];

  /** Domain whitelist for exemptions (corporate domains) */
  domainWhitelist?: string[];

  /** Regex patterns to detect sensitive content */
  sensitivePatterns: RegExp[];
}

/**
 * Privacy level classification
 */
export type PrivacyLevel = 'full' | 'domain_only' | 'redacted';

/**
 * List of sensitive domains that should be fully redacted
 */
const SENSITIVE_DOMAINS = [
  // Email services
  'mail.google.com',
  'outlook.office.com',
  'outlook.live.com',
  'mail.yahoo.com',
  'mail.aol.com',

  // Banking (generic patterns - actual banks vary by region)
  'banking',
  'bankofamerica.com',
  'chase.com',
  'wellsfargo.com',
  'citibank.com',

  // Medical/Health
  'health',
  'medical',
  'hospital',

  // Financial
  'paypal.com',
  'stripe.com',
  'square.com',

  // Personal services
  'facebook.com',
  'twitter.com',
  'linkedin.com',
];

/**
 * Sanitize a URL according to privacy configuration
 *
 * Processing steps:
 * 1. Parse URL (return [INVALID_URL] on failure)
 * 2. Check if domain is sensitive (return [REDACTED_SENSITIVE])
 * 3. Strip query parameters except whitelisted ones
 * 4. Remove URL fragments (#hash)
 * 5. Test against sensitive patterns (return [REDACTED_PATTERN])
 * 6. Return sanitized URL
 *
 * @param url - Raw URL string to sanitize
 * @param config - Privacy configuration
 * @returns Sanitized URL or redaction marker
 *
 * @example
 * ```typescript
 * const url = 'https://example.com/page?token=abc123&page=1';
 * const sanitized = sanitizeUrl(url, {
 *   stripQueryParams: true,
 *   queryParamWhitelist: ['page'],
 *   sensitivePatterns: [/token=/i]
 * });
 * // Returns: 'https://example.com/page?page=1'
 * ```
 */
export function sanitizeUrl(url: string, config: PrivacyConfig): string {
  try {
    // Step 1: Parse URL
    const urlObj = new URL(url);

    // Step 2: Check for sensitive domains
    if (isSensitiveDomain(urlObj.hostname, config)) {
      logger.debug('[PrivacyHelper] Redacting sensitive domain', { hostname: urlObj.hostname });
      return '[REDACTED_SENSITIVE]';
    }

    // Step 2.5: Check against sensitive patterns BEFORE stripping
    // This ensures we catch sensitive data in query params before removal
    const originalUrl = urlObj.toString();
    for (const pattern of config.sensitivePatterns) {
      if (pattern.test(originalUrl)) {
        logger.debug('[PrivacyHelper] Redacting pattern match', { pattern: pattern.source });
        return '[REDACTED_PATTERN]';
      }
    }

    // Step 3: Strip query parameters (except whitelisted)
    if (config.stripQueryParams) {
      const allowedParams = new URLSearchParams();
      const whitelist = config.queryParamWhitelist || [];

      urlObj.searchParams.forEach((value, key) => {
        if (whitelist.includes(key)) {
          allowedParams.set(key, value);
        }
      });

      urlObj.search = allowedParams.toString();
    }

    // Step 4: Remove URL fragment
    urlObj.hash = '';

    return urlObj.toString();

  } catch (error) {
    // Invalid URL format
    logger.warn('[PrivacyHelper] Invalid URL format', { url, error });
    return '[INVALID_URL]';
  }
}

/**
 * Check if a hostname is considered sensitive
 *
 * Checks against:
 * 1. Domain whitelist (if present, allows exemption)
 * 2. Hardcoded sensitive domains list
 *
 * @param hostname - Hostname to check (e.g., 'mail.google.com')
 * @param config - Privacy configuration with optional domain whitelist
 * @returns True if domain should be redacted
 *
 * @example
 * ```typescript
 * isSensitiveDomain('mail.google.com', {
 *   domainWhitelist: ['company-internal.com']
 * }); // Returns: true
 *
 * isSensitiveDomain('company-internal.com', {
 *   domainWhitelist: ['company-internal.com']
 * }); // Returns: false (whitelisted)
 * ```
 */
export function isSensitiveDomain(hostname: string, config: PrivacyConfig): boolean {
  // Check domain whitelist first (exemptions)
  if (config.domainWhitelist && config.domainWhitelist.length > 0) {
    const isWhitelisted = config.domainWhitelist.some(whitelistedDomain =>
      hostname.includes(whitelistedDomain)
    );

    if (isWhitelisted) {
      return false; // Whitelisted domains are NOT sensitive
    }
  }

  // Check against sensitive domains list
  return SENSITIVE_DOMAINS.some(sensitiveDomain =>
    hostname.includes(sensitiveDomain)
  );
}

/**
 * Determine privacy level of a sanitized URL
 *
 * Used for categorizing URLs in data storage and analytics.
 *
 * @param url - Sanitized URL string
 * @returns Privacy level classification
 *
 * @example
 * ```typescript
 * getPrivacyLevel('https://example.com/page'); // 'full'
 * getPrivacyLevel('[REDACTED_SENSITIVE]'); // 'redacted'
 * ```
 */
export function getPrivacyLevel(url: string): PrivacyLevel {
  if (url.startsWith('[REDACTED') || url === '[INVALID_URL]') {
    return 'redacted';
  }

  // Check if only domain remains (no path)
  try {
    const urlObj = new URL(url);
    if (urlObj.pathname === '/' && !urlObj.search) {
      return 'domain_only';
    }
  } catch {
    return 'redacted';
  }

  return 'full';
}

/**
 * Batch sanitize multiple URLs efficiently
 *
 * @param urls - Array of raw URLs
 * @param config - Privacy configuration
 * @returns Array of sanitized URLs
 */
export function sanitizeUrlBatch(urls: string[], config: PrivacyConfig): string[] {
  return urls.map(url => sanitizeUrl(url, config));
}

/**
 * Validate privacy configuration
 *
 * Ensures config is properly structured before use.
 *
 * @param config - Privacy configuration to validate
 * @returns True if valid, throws error otherwise
 * @throws {Error} If configuration is invalid
 */
export function validatePrivacyConfig(config: PrivacyConfig): boolean {
  if (typeof config.stripQueryParams !== 'boolean') {
    throw new Error('stripQueryParams must be a boolean');
  }

  if (config.queryParamWhitelist && !Array.isArray(config.queryParamWhitelist)) {
    throw new Error('queryParamWhitelist must be an array');
  }

  if (config.domainWhitelist && !Array.isArray(config.domainWhitelist)) {
    throw new Error('domainWhitelist must be an array');
  }

  if (!Array.isArray(config.sensitivePatterns)) {
    throw new Error('sensitivePatterns must be an array');
  }

  for (const pattern of config.sensitivePatterns) {
    if (!(pattern instanceof RegExp)) {
      throw new Error('All sensitivePatterns must be RegExp instances');
    }
  }

  return true;
}
