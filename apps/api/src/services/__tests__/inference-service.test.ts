import { describe, expect, it, vi } from 'vitest';
import { InferenceClientError, type InferenceClient } from '../../clients/inference-client.js';
import { InferenceService, type ResiliencePolicy } from '../inference-service.js';

const policy: ResiliencePolicy = {
  maxAttempts: 3,
  attemptTimeoutMs: 50,
  modelDeadlineMs: 500,
  baseBackoffMs: 10,
  maxBackoffMs: 100
};

function clientWithChat(chat: ReturnType<typeof vi.fn>): InferenceClient {
  return { chat } as unknown as InferenceClient;
}

describe('InferenceService resilience', () => {
  it('retries a retryable 429 and then succeeds', async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new InferenceClientError('rate limited', 429, true))
      .mockResolvedValueOnce({ text: 'ok', inputTokens: 10, outputTokens: 20 });
    const sleep = vi.fn(async () => undefined);
    const service = new InferenceService(clientWithChat(chat), policy, sleep, () => 0.5);

    const result = await service.invoke('model-a', 'hello');

    expect(chat).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      model: 'model-a',
      status: 'SUCCESS',
      response: 'ok',
      attempts: 2,
      retryCount: 1
    });
  });

  it('does not retry a non-retryable 400', async () => {
    const chat = vi.fn().mockRejectedValue(new InferenceClientError('bad request', 400, false));
    const sleep = vi.fn(async () => undefined);
    const service = new InferenceService(clientWithChat(chat), policy, sleep, () => 0.5);

    const result = await service.invoke('model-a', 'hello');

    expect(chat).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      retryCount: 0,
      error: 'The model provider could not complete the request.'
    });
  });

  it('stops after retry exhaustion', async () => {
    const chat = vi.fn().mockRejectedValue(new InferenceClientError('service unavailable', 503, true));
    const sleep = vi.fn(async () => undefined);
    const service = new InferenceService(clientWithChat(chat), policy, sleep, () => 0.5);

    const result = await service.invoke('model-a', 'hello');

    expect(chat).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      retryCount: 2,
      error: 'The model provider could not complete the request.'
    });
  });

  it('returns TIMEOUT after attempts repeatedly exceed the timeout', async () => {
    const chat = vi.fn((_model: string, _prompt: string, _temperature: number, _maxTokens: number, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    );
    const timeoutPolicy = { ...policy, maxAttempts: 2, attemptTimeoutMs: 10, modelDeadlineMs: 100 };
    const service = new InferenceService(clientWithChat(chat), timeoutPolicy, async () => undefined, () => 0);

    const result = await service.invoke('slow-model', 'hello');

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('TIMEOUT');
    expect(result.attempts).toBe(2);
    expect(result.retryCount).toBe(1);
  });

  it('honors Retry-After when supplied by the provider', async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new InferenceClientError('rate limited', 429, true, 75))
      .mockResolvedValueOnce({ text: 'ok' });
    const sleep = vi.fn(async () => undefined);
    const service = new InferenceService(clientWithChat(chat), policy, sleep, () => 0);

    await service.invoke('model-a', 'hello');

    expect(sleep).toHaveBeenCalledWith(75);
  });

  it('reports retry progress without changing retry behavior', async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new InferenceClientError('temporarily unavailable', 503, true))
      .mockResolvedValueOnce({ text: 'ok' });
    const onRetry = vi.fn();
    const service = new InferenceService(clientWithChat(chat), policy, async () => undefined, () => 0);

    const result = await service.invoke('model-a', 'hello', 0.2, 1000, { onRetry });

    expect(result.status).toBe('SUCCESS');
    expect(onRetry).toHaveBeenCalledWith({
      model: 'model-a',
      nextAttempt: 2,
      delayMs: 0,
      reason: 'The model provider could not complete the request.'
    });
  });
});
