export type ModelResultStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT';

export interface ModelInfo {
  id: string;
  name?: string;
  ownedBy?: string;
}

export interface ModelResult {
  model: string;
  status: ModelResultStatus;
  response?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  attempts?: number;
  retryCount?: number;
  evaluation?: { passed: boolean; overall: number; relevance: number; safety: number };
}

export interface ComparisonRequest {
  prompt: string;
  models: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface ComparisonResponse {
  comparisonId: string;
  status: 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED';
  results: ModelResult[];
}

export type ComparisonProgressEvent =
  | { type: 'comparison_started'; comparisonId: string; models: string[] }
  | { type: 'model_started'; comparisonId: string; model: string }
  | {
      type: 'model_retrying';
      comparisonId: string;
      model: string;
      nextAttempt: number;
      delayMs: number;
      reason: string;
    }
  | {
      type: 'model_completed' | 'model_failed';
      comparisonId: string;
      result: ModelResult;
    }
  | { type: 'comparison_completed'; comparison: ComparisonResponse };
