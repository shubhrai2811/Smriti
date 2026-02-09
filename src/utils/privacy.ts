/**
 * Privacy utilities for Smriti.
 *
 * Handles stripping private tags and redacting secrets before
 * observations are stored in the database.
 */

/**
 * Removes <private>...</private> tags and all content between them.
 * Handles multiline content and nested whitespace.
 */
export function stripPrivateTags(text: string): string {
  // Use dotAll (s flag) so . matches newlines inside tags
  return text.replace(/<private>[\s\S]*?<\/private>/gi, '');
}

/**
 * Secret detection patterns.
 * Each entry has a human-readable name and a regex.
 * Regexes are designed to match common secret formats with
 * reasonable precision to avoid false positives.
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // AWS Access Key IDs (always start with AKIA)
  { name: 'AWS Access Key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },

  // AWS Secret Access Keys (40 chars, base64-ish)
  { name: 'AWS Secret Key', pattern: /\b[0-9a-zA-Z/+=]{40}\b(?=.*(?:aws|secret|key))/gi },

  // Anthropic API keys (sk-ant-* — must be before generic sk- pattern)
  { name: 'Anthropic API Key', pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g },

  // OpenAI API keys (sk- with 48+ chars — must be before generic sk- pattern)
  { name: 'OpenAI API Key', pattern: /\bsk-[a-zA-Z0-9]{48,}\b/g },

  // Generic API keys (common formats: sk-*, api_*, key-*, etc.)
  { name: 'API Key', pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g },
  { name: 'API Key', pattern: /\b(api[_-]?key[_-]?[=:]\s*["']?[a-zA-Z0-9_-]{20,})["']?/gi },

  // NPM access tokens
  { name: 'NPM Token', pattern: /\bnpm_[a-zA-Z0-9]{36}\b/g },

  // Google API keys (Cloud / Firebase)
  { name: 'Google API Key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },

  // Stripe keys (secret and publishable, live and test)
  { name: 'Stripe Secret Key', pattern: /\bsk_(?:live|test)_[a-zA-Z0-9]{24,}\b/g },
  { name: 'Stripe Publishable Key', pattern: /\bpk_(?:live|test)_[a-zA-Z0-9]{24,}\b/g },

  // SendGrid API keys
  { name: 'SendGrid API Key', pattern: /\bSG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}\b/g },

  // Twilio API Key SIDs
  { name: 'Twilio API Key', pattern: /\bSK[a-f0-9]{32}\b/g },

  // Bearer tokens in authorization headers
  { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_\-.~+/]+=*/g },

  // Basic auth headers (Base64-encoded credentials)
  { name: 'Basic Auth', pattern: /\bbasic\s+[a-zA-Z0-9+/]{20,}={0,2}\b/gi },

  // Private keys (PEM format)
  {
    name: 'Private Key',
    pattern:
      /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/g,
  },

  // Passwords in connection strings or assignments
  { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"']{8,}["']?/gi },

  // Connection strings with credentials
  { name: 'Connection String', pattern: /(?:mongodb|postgres|postgresql|mysql|redis|amqp):\/\/[^:]+:[^@]+@[^\s"']+/gi },

  // Hex-encoded secrets in config assignments (secret= or secret: followed by 32-64 hex chars)
  { name: 'Hex Secret', pattern: /\bsecret\s*[=:]\s*["']?[a-f0-9]{32,64}["']?/gi },

  // SSH private key file paths
  { name: 'SSH Key Path', pattern: /~\/\.ssh\/id_[a-z]+/g },

  // GitHub tokens (classic PAT and fine-grained)
  { name: 'GitHub Token', pattern: /\b(ghp_[a-zA-Z0-9]{36})\b/g },
  { name: 'GitHub Token', pattern: /\b(github_pat_[a-zA-Z0-9_]{22,})\b/g },
  { name: 'GitHub Token', pattern: /\b(gho_[a-zA-Z0-9]{36})\b/g },
  { name: 'GitHub Token', pattern: /\b(ghu_[a-zA-Z0-9]{36})\b/g },
  { name: 'GitHub Token', pattern: /\b(ghs_[a-zA-Z0-9]{36})\b/g },

  // Slack tokens
  { name: 'Slack Token', pattern: /\b(xox[bporas]-[0-9a-zA-Z-]{10,})\b/g },

  // JWTs (three base64url segments separated by dots)
  { name: 'JWT', pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g },
];

/**
 * Scans text for common secret patterns and redacts them.
 * Returns the redacted text and a list of what was detected.
 */
export function redactSecrets(text: string): { redacted: string; detected: string[] } {
  const detected: string[] = [];
  let redacted = text;

  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;

    if (pattern.test(redacted)) {
      detected.push(name);
      // Reset again before replace
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, `[REDACTED:${name}]`);
    }
  }

  // Deduplicate detected list
  return {
    redacted,
    detected: [...new Set(detected)],
  };
}

/**
 * Combines private tag stripping and secret redaction.
 * This is the main entry point for sanitizing text before storage.
 */
export function sanitizeForStorage(
  text: string,
  config?: { redactSecrets?: boolean; stripPrivateTags?: boolean },
): string {
  let result = text;

  // Default both to true if not specified
  const shouldStripPrivate = config?.stripPrivateTags ?? true;
  const shouldRedact = config?.redactSecrets ?? true;

  if (shouldStripPrivate) {
    result = stripPrivateTags(result);
  }

  if (shouldRedact) {
    const { redacted } = redactSecrets(result);
    result = redacted;
  }

  return result;
}
