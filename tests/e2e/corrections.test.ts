import { describe, expect, it } from 'bun:test';
import { detectCorrection } from '../../src/services/extraction/corrections';

describe('Correction Pattern Detection', () => {
  describe('detectCorrection', () => {
    it('detects "no, use X" pattern', () => {
      const result = detectCorrection('no, use TypeScript instead');
      expect(result.isCorrection).toBe(true);
      expect(result.matchedPattern).toBeTruthy();
    });

    it('detects "actually, use X" pattern', () => {
      const result = detectCorrection('actually, use Bun for this');
      expect(result.isCorrection).toBe(true);
    });

    it('detects "don\'t use X" pattern', () => {
      const result = detectCorrection("don't use Express, prefer Hono");
      expect(result.isCorrection).toBe(true);
    });

    it('detects "I prefer" pattern', () => {
      const result = detectCorrection('I prefer tabs over spaces');
      expect(result.isCorrection).toBe(true);
    });

    it('detects "that\'s wrong" pattern', () => {
      const result = detectCorrection("that's wrong, the port should be 3000");
      expect(result.isCorrection).toBe(true);
    });

    it('detects "stop using" pattern', () => {
      const result = detectCorrection('stop using var, use const');
      expect(result.isCorrection).toBe(true);
    });

    it('detects "please change" pattern', () => {
      const result = detectCorrection('please change the database driver');
      expect(result.isCorrection).toBe(true);
    });

    it('detects "instead, do X" pattern', () => {
      const result = detectCorrection('instead, do it with async/await');
      expect(result.isCorrection).toBe(true);
    });

    it('does not flag normal prompts', () => {
      const result = detectCorrection('Can you implement a login page?');
      expect(result.isCorrection).toBe(false);
      expect(result.matchedPattern).toBeUndefined();
    });

    it('does not flag empty strings', () => {
      const result = detectCorrection('');
      expect(result.isCorrection).toBe(false);
    });

    it('does not flag technical text with similar words', () => {
      const result = detectCorrection('The function should use the database connection');
      expect(result.isCorrection).toBe(false);
    });

    it('handles case insensitivity', () => {
      const result = detectCorrection('NO, USE PostgreSQL!');
      expect(result.isCorrection).toBe(true);
    });
  });
});
