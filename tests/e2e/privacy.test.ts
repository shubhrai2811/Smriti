import { describe, it, expect } from 'bun:test';
import { stripPrivateTags, redactSecrets, sanitizeForStorage } from '../../src/utils/privacy';

describe('Privacy E2E', () => {
  describe('stripPrivateTags', () => {
    it('strips simple private tags', () => {
      const input = 'Hello <private>secret</private> world';
      expect(stripPrivateTags(input)).toBe('Hello  world');
    });

    it('strips multiline private content', () => {
      const input = 'Before\n<private>\nThis is\nmultiline secret\n</private>\nAfter';
      expect(stripPrivateTags(input)).toBe('Before\n\nAfter');
    });

    it('strips multiple private sections', () => {
      const input = 'A <private>secret1</private> B <private>secret2</private> C';
      expect(stripPrivateTags(input)).toBe('A  B  C');
    });

    it('handles case-insensitive tags', () => {
      const input = 'Hello <PRIVATE>secret</PRIVATE> world';
      expect(stripPrivateTags(input)).toBe('Hello  world');
    });

    it('returns unchanged text when no private tags', () => {
      const input = 'Just normal text here';
      expect(stripPrivateTags(input)).toBe(input);
    });
  });

  describe('redactSecrets', () => {
    it('redacts AWS access keys', () => {
      const input = 'My key is AKIAIOSFODNN7EXAMPLE';
      const { redacted, detected } = redactSecrets(input);
      expect(redacted).toContain('[REDACTED:');
      expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(detected).toContain('AWS Access Key');
    });

    it('redacts API keys with sk- prefix', () => {
      const input = 'Token: sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const { redacted, detected } = redactSecrets(input);
      expect(redacted).toContain('[REDACTED:');
      expect(detected).toContain('API Key');
    });

    it('redacts GitHub tokens', () => {
      const input = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      const { redacted, detected } = redactSecrets(input);
      expect(redacted).toContain('[REDACTED:');
      expect(detected).toContain('GitHub Token');
    });

    it('redacts Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const { redacted, detected } = redactSecrets(input);
      expect(redacted).toContain('[REDACTED:');
    });

    it('returns original text when no secrets found', () => {
      const input = 'Just normal code: function hello() { return "world"; }';
      const { redacted, detected } = redactSecrets(input);
      expect(redacted).toBe(input);
      expect(detected).toHaveLength(0);
    });
  });

  describe('sanitizeForStorage', () => {
    it('applies both private tag stripping and secret redaction', () => {
      const input = 'Code: <private>my password is hunter2</private> Also AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeForStorage(input);
      expect(result).not.toContain('hunter2');
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('respects config to disable redaction', () => {
      const input = 'Token: sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const result = sanitizeForStorage(input, { redactSecrets: false });
      expect(result).toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    });

    it('respects config to disable private tag stripping', () => {
      const input = 'Hello <private>secret</private> world';
      const result = sanitizeForStorage(input, { stripPrivateTags: false });
      expect(result).toContain('<private>secret</private>');
    });
  });
});
