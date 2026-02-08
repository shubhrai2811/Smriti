const CORRECTION_PATTERNS = [
  /\b(?:no|nope|wrong),?\s+(?:use|do|try|prefer|want|need)\b/i,
  /\b(?:actually|instead),?\s+(?:use|do|let'?s?|prefer|want)\b/i,
  /\bdon'?t\s+(?:use|do|add|include|mention|create)\b/i,
  /\bi\s+prefer\b/i,
  /\bthat'?s?\s+(?:wrong|incorrect|not right|not what)\b/i,
  /\bnot\s+(?:like that|that way|not what i)\b/i,
  /\bstop\s+(?:using|doing|adding)\b/i,
  /\bplease?\s+(?:change|switch|replace|remove)\b/i,
];

export function detectCorrection(promptText: string): {
  isCorrection: boolean;
  matchedPattern?: string;
} {
  for (const pattern of CORRECTION_PATTERNS) {
    const match = promptText.match(pattern);
    if (match) {
      return { isCorrection: true, matchedPattern: match[0] };
    }
  }
  return { isCorrection: false };
}
