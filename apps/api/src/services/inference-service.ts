import { InferenceClient, InferenceClientError } from '../clients/inference-client.js';
import type { ModelResult } from '../models/inference.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { OUTPUT_QUARANTINED_MESSAGE } from '../guardrails/guardrails.constants.js';
import { GuardrailsService } from '../guardrails/guardrails.service.js';
import { TokenGovernanceService } from '../governance/token-governance.service.js';
import { MetricsService } from '../observability/metrics.service.js';

export const RESILIENCE_POLICY = Symbol('RESILIENCE_POLICY');
export const RESILIENCE_SLEEP = Symbol('RESILIENCE_SLEEP');
export const RESILIENCE_RANDOM = Symbol('RESILIENCE_RANDOM');

export interface ResiliencePolicy {
  maxAttempts: number;
  attemptTimeoutMs: number;
  modelDeadlineMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface InferenceProgressReporter {
  onRetry(event: {
    model: string;
    nextAttempt: number;
    delayMs: number;
    reason: string;
  }): void;
}

const DEFAULT_POLICY: ResiliencePolicy = {
  maxAttempts: 3,
  attemptTimeoutMs: 8_000,
  modelDeadlineMs: 20_000,
  baseBackoffMs: 250,
  maxBackoffMs: 2_000
};

@Injectable()
export class InferenceService {
  constructor(
    @Inject(InferenceClient) private readonly client: InferenceClient,
    @Optional() @Inject(RESILIENCE_POLICY) private readonly policy: ResiliencePolicy = DEFAULT_POLICY,
    @Optional() @Inject(RESILIENCE_SLEEP) private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    @Optional() @Inject(RESILIENCE_RANDOM) private readonly random: () => number = Math.random,
    @Optional() @Inject(GuardrailsService) private readonly guardrails: GuardrailsService = new GuardrailsService(),
    @Optional() @Inject(TokenGovernanceService) private readonly governance?: TokenGovernanceService,
    @Optional() @Inject(MetricsService) private readonly metrics?: MetricsService
  ) {}

  async invoke(
    model: string,
    prompt: string,
    temperature = 0.2,
    maxTokens = 1000,
    progress?: InferenceProgressReporter
  ): Promise<ModelResult> {
    const started = performance.now();
    const governed = this.governance?.apply(prompt, maxTokens) ?? {
      prompt, maxTokens, estimatedInputTokens: Math.ceil(prompt.length / 4), compacted: false
    };
    const deadlineAt = Date.now() + this.policy.modelDeadlineMs;
    let attempts = 0;
    let lastError: unknown;

    while (attempts < this.policy.maxAttempts) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        return this.timeoutResult(model, started, attempts, 'Model deadline exceeded');
      }

      attempts += 1;
      const controller = new AbortController();
      const attemptTimeoutMs = Math.min(this.policy.attemptTimeoutMs, remainingMs);
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        const result = await this.client.chat(model, governed.prompt, temperature, governed.maxTokens, {
          signal: controller.signal
        });

        const outputDecision = this.guardrails.inspectOutput(result.text);
        if (!outputDecision.allowed) {
          return {
            model,
            status: 'FAILED',
            latencyMs: Math.round(performance.now() - started),
            error: OUTPUT_QUARANTINED_MESSAGE,
            attempts,
            retryCount: attempts - 1
          };
        }

        const successResult: ModelResult = {
          model,
          status: 'SUCCESS',
          response: result.text,
          latencyMs: Math.round(performance.now() - started),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          attempts,
          retryCount: attempts - 1
        };
        this.metrics?.record({
          model,
          success: true,
          latencyMs: successResult.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          retries: attempts - 1
        });
        return successResult;
      } catch (error) {
        lastError = error;
        const timedOut = controller.signal.aborted;
        const retryable = timedOut || this.isRetryable(error);
        const canRetry = retryable && attempts < this.policy.maxAttempts;

        if (!canRetry) {
          if (timedOut) {
            return this.timeoutResult(model, started, attempts, `Inference attempt timed out after ${attemptTimeoutMs}ms`);
          }

          return {
            model,
            status: 'FAILED',
            latencyMs: Math.round(performance.now() - started),
            error: this.errorMessage(error),
            attempts,
            retryCount: attempts - 1
          };
        }

        const remainingAfterAttempt = deadlineAt - Date.now();
        if (remainingAfterAttempt <= 0) {
          return this.timeoutResult(model, started, attempts, 'Model deadline exceeded');
        }

        const delayMs = Math.min(
          this.retryDelayMs(error, attempts),
          remainingAfterAttempt
        );

        progress?.onRetry({
          model,
          nextAttempt: attempts + 1,
          delayMs,
          reason: this.guardrails.safeProviderError(error)
        });

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      model,
      status: 'FAILED',
      latencyMs: Math.round(performance.now() - started),
      error: this.guardrails.safeProviderError(lastError),
      attempts,
      retryCount: Math.max(0, attempts - 1)
    };
  }

  private isRetryable(error: unknown): boolean {
    return error instanceof InferenceClientError && error.retryable;
  }

  private retryDelayMs(error: unknown, attempt: number): number {
    if (error instanceof InferenceClientError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, this.policy.maxBackoffMs);
    }

    const exponentialCap = Math.min(
      this.policy.maxBackoffMs,
      this.policy.baseBackoffMs * 2 ** (attempt - 1)
    );

    return Math.floor(this.random() * exponentialCap);
  }

  private timeoutResult(model: string, started: number, attempts: number, error: string): ModelResult {
    return {
      model,
      status: 'TIMEOUT',
      latencyMs: Math.round(performance.now() - started),
      error,
      attempts,
      retryCount: Math.max(0, attempts - 1)
    };
  }

  private errorMessage(error: unknown): string {
    return this.guardrails.safeProviderError(error);
  }
}
