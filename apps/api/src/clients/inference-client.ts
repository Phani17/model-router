import { env } from '../config/env.js';
import type { ModelInfo } from '../models/inference.js';
import { Injectable } from '@nestjs/common';

export class InferenceClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'InferenceClientError';
  }
}

export interface ChatOptions {
  signal?: AbortSignal;
}

@Injectable()
export class InferenceClient {
  private readonly baseUrl = env.DIGITALOCEAN_INFERENCE_BASE_URL.replace(/\/$/, '');

  private headers(): HeadersInit {
    if (!env.DIGITALOCEAN_MODEL_ACCESS_KEY) {
      throw new InferenceClientError('DIGITALOCEAN_MODEL_ACCESS_KEY is not configured', 401, false);
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DIGITALOCEAN_MODEL_ACCESS_KEY}`
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.headers()
    });

    if (!response.ok) {
      throw await this.toClientError(response, 'model catalog');
    }

    const body = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
    return (body.data ?? []).map(model => ({
      id: model.id,
      name: model.id,
      ownedBy: model.owned_by
    }));
  }

  async chat(
    model: string,
    prompt: string,
    temperature = 0.2,
    maxTokens = 1000,
    options: ChatOptions = {}
  ): Promise<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
  }> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens
        })
      });
    } catch (error) {
      if (error instanceof InferenceClientError) {
        throw error;
      }
      if (options.signal?.aborted) {
        throw error;
      }
      throw new InferenceClientError(
        error instanceof Error ? `DigitalOcean inference network error: ${error.message}` : 'DigitalOcean inference network error',
        undefined,
        true
      );
    }

    if (!response.ok) {
      throw await this.toClientError(response, 'inference');
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: body.choices?.[0]?.message?.content ?? '',
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens
    };
  }

  private async toClientError(response: Response, operation: string): Promise<InferenceClientError> {
    const message = await response.text();
    const status = response.status;
    const retryable = status === 408 || status === 429 || status >= 500;
    const retryAfterMs = this.parseRetryAfter(response.headers.get('retry-after'));

    return new InferenceClientError(
      `DigitalOcean ${operation} returned HTTP ${status}${message ? `: ${message}` : ''}`,
      status,
      retryable,
      retryAfterMs
    );
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, date - Date.now());
  }
}
