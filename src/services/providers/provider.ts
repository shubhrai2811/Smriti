export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export interface AIProvider {
  readonly name: string;
  extract(prompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  getLastUsage(): TokenUsageInfo | null;
}
