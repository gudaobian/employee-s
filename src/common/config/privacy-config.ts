/**
 * Privacy Configuration Defaults
 *
 * Default privacy settings for URL sanitization in the Employee Monitoring System.
 *
 * These settings implement a "privacy-by-default" approach:
 * - Strip all query parameters except explicitly whitelisted ones
 * - Detect and redact sensitive domains (email, banking, etc.)
 * - Pattern-based detection of tokens, keys, and sensitive data
 *
 * Configuration can be customized per deployment based on:
 * - Regulatory requirements (GDPR, CCPA, etc.)
 * - Corporate privacy policies
 * - Industry-specific compliance needs
 *
 * @module privacy-config
 */

import { PrivacyConfig } from '../utils/privacy-helper';

/**
 * Default privacy configuration
 *
 * This configuration provides strong privacy protection suitable for
 * most enterprise deployments.
 *
 * Customization Guidelines:
 * - Add corporate domains to domainWhitelist if less strict filtering needed
 * - Add safe query parameters to queryParamWhitelist (e.g., 'lang', 'page')
 * - Add custom sensitivePatterns for industry-specific sensitive data
 */
export const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = {
  /**
   * Strip all query parameters by default
   *
   * Query parameters often contain:
   * - Authentication tokens (token=, session=)
   * - User identifiers (user_id=, email=)
   * - Tracking parameters (utm_source=, gclid=)
   * - Sensitive search queries
   */
  stripQueryParams: true,

  /**
   * Whitelist of allowed query parameters
   *
   * Only these parameters will be preserved after sanitization.
   * These are generally considered non-sensitive navigational parameters.
   */
  queryParamWhitelist: [
    'page',      // Pagination parameter
    'lang',      // Language/locale parameter
    'sort',      // Sorting preference
    'view',      // View mode (list/grid)
    'tab',       // Tab selection
    // NOTE: Add more as needed, but be conservative
  ],

  /**
   * Domain whitelist (optional exemptions)
   *
   * Domains in this list will NOT be redacted even if they match
   * sensitive domain patterns. Use for corporate/internal domains.
   *
   * Example:
   * - 'company-internal.com'
   * - 'intranet.company.com'
   */
  domainWhitelist: [
    // Intentionally empty by default
    // Customize per deployment based on corporate domains
  ],

  /**
   * Sensitive content patterns
   *
   * URLs matching any of these patterns will be completely redacted.
   * Patterns are tested against the full URL string.
   */
  sensitivePatterns: [
    // Authentication tokens
    /token=/i,
    /access[_-]?token=/i,
    /refresh[_-]?token=/i,
    /bearer[_-]?token=/i,
    /auth[_-]?token=/i,

    // API keys and secrets
    /api[_-]?key=/i,
    /secret[_-]?key=/i,
    /client[_-]?secret=/i,
    /private[_-]?key=/i,

    // Password-related
    /password=/i,
    /passwd=/i,
    /pwd=/i,

    // Session identifiers
    /session[_-]?id=/i,
    /jsessionid=/i,
    /phpsessid=/i,

    // OAuth and authentication
    /oauth[_-]?token=/i,
    /code=/i, // OAuth authorization codes (be careful with this - might be too broad)

    // Credit card numbers (13-19 digits)
    // Pattern detects potential credit card numbers in URLs
    /\b\d{13,19}\b/,

    // Social Security Numbers (US format: XXX-XX-XXXX)
    /\b\d{3}-\d{2}-\d{4}\b/,

    // Email addresses in URLs (might be too aggressive)
    /email=[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i,

    // Financial account numbers (generic pattern)
    /account[_-]?number=/i,

    // Personal identifiers
    /ssn=/i,
    /tax[_-]?id=/i,
    /national[_-]?id=/i,

    // Health-related (HIPAA compliance)
    /patient[_-]?id=/i,
    /medical[_-]?record=/i,
    /diagnosis=/i,
  ],
};

/**
 * Minimal privacy configuration
 *
 * Use this for non-sensitive deployments or testing environments
 * where less aggressive filtering is acceptable.
 *
 * WARNING: Not recommended for production use without thorough
 * privacy impact assessment.
 */
export const MINIMAL_PRIVACY_CONFIG: PrivacyConfig = {
  stripQueryParams: false, // Keep all query params
  queryParamWhitelist: undefined,
  domainWhitelist: [],
  sensitivePatterns: [
    // Only redact obvious sensitive patterns
    /password=/i,
    /token=/i,
    /api[_-]?key=/i,
  ],
};

/**
 * Strict privacy configuration
 *
 * Maximum privacy protection for highly regulated industries
 * (healthcare, finance, government).
 *
 * - Strips all query parameters (no whitelist)
 * - Extensive sensitive domain list
 * - Aggressive pattern matching
 */
export const STRICT_PRIVACY_CONFIG: PrivacyConfig = {
  stripQueryParams: true,
  queryParamWhitelist: [], // Strip ALL query parameters
  domainWhitelist: [],
  sensitivePatterns: [
    ...DEFAULT_PRIVACY_CONFIG.sensitivePatterns,

    // Additional strict patterns
    /user[_-]?id=/i,
    /customer[_-]?id=/i,
    /order[_-]?id=/i,
    /invoice=/i,

    // Any parameter with 'id' (might be too aggressive)
    /\bid=\d+/i,

    // Any long alphanumeric strings (potential tokens)
    /[a-f0-9]{32,}/i, // 32+ hex chars (likely tokens)
  ],
};

/**
 * Get privacy configuration based on environment or deployment type
 *
 * @param environment - Deployment environment or privacy level
 * @returns Appropriate privacy configuration
 */
export function getPrivacyConfigForEnvironment(
  environment: 'development' | 'testing' | 'production' | 'strict'
): PrivacyConfig {
  switch (environment) {
    case 'development':
      return MINIMAL_PRIVACY_CONFIG;

    case 'testing':
      return DEFAULT_PRIVACY_CONFIG;

    case 'production':
      return DEFAULT_PRIVACY_CONFIG;

    case 'strict':
      return STRICT_PRIVACY_CONFIG;

    default:
      return DEFAULT_PRIVACY_CONFIG;
  }
}

/**
 * Merge custom privacy configuration with defaults
 *
 * Allows partial customization while maintaining safe defaults.
 *
 * @param customConfig - Partial configuration to merge
 * @returns Complete privacy configuration
 *
 * @example
 * ```typescript
 * const config = mergePrivacyConfig({
 *   domainWhitelist: ['company.com'],
 *   queryParamWhitelist: ['page', 'lang', 'customParam']
 * });
 * ```
 */
export function mergePrivacyConfig(
  customConfig: Partial<PrivacyConfig>
): PrivacyConfig {
  return {
    ...DEFAULT_PRIVACY_CONFIG,
    ...customConfig,

    // Array fields need special handling to merge, not replace
    queryParamWhitelist: customConfig.queryParamWhitelist
      ? [...(DEFAULT_PRIVACY_CONFIG.queryParamWhitelist || []), ...customConfig.queryParamWhitelist]
      : DEFAULT_PRIVACY_CONFIG.queryParamWhitelist,

    sensitivePatterns: customConfig.sensitivePatterns
      ? [...DEFAULT_PRIVACY_CONFIG.sensitivePatterns, ...customConfig.sensitivePatterns]
      : DEFAULT_PRIVACY_CONFIG.sensitivePatterns,

    domainWhitelist: customConfig.domainWhitelist
      ? [...(DEFAULT_PRIVACY_CONFIG.domainWhitelist || []), ...customConfig.domainWhitelist]
      : DEFAULT_PRIVACY_CONFIG.domainWhitelist,
  };
}
