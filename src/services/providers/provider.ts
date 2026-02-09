export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export interface ExtractOpts {
  sessionId?: number;
  operation?: string;
}

export interface AIProvider {
  readonly name: string;
  extract(prompt: string, opts?: ExtractOpts): Promise<string>;
  isAvailable(): Promise<boolean>;
  getLastUsage(): TokenUsageInfo | null;
}
