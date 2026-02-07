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

  // Generic API keys (common formats: sk-*, api_*, key-*, etc.)
  { name: 'API Key', pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g },
  { name: 'API Key', pattern: /\b(api[_-]?key[_-]?[=:]\s*["']?[a-zA-Z0-9_\-]{20,})["']?/gi },

  // Bearer tokens in authorization headers
  { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_\-.~+/]+=*/g },

  // Private keys (PEM format)
  { name: 'Private Key', pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/g },

  // Passwords in connection strings or assignments
  { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"']{8,}["']?/gi },

  // Connection strings with credentials
  { name: 'Connection String', pattern: /(?:mongodb|postgres|postgresql|mysql|redis|amqp):\/\/[^:]+:[^@]+@[^\s"']+/gi },

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
