import { describe, expect, it, vi } from 'vitest';
import { RouterService } from '../router.service.js';
import type { ModelResult } from '../../models/inference.js';

const success = (model: string): ModelResult => ({
  model, status: 'SUCCESS' as const, response: `answer:${model}`, latencyMs: 10, attempts: 1, retryCount: 0
});
const failure = (model: string): ModelResult => ({
  model, status: 'FAILED' as const, error: 'safe failure', latencyMs: 10, attempts: 3, retryCount: 2
});

function createService(options: { routing?: boolean; fallbacks?: boolean; ranked?: string[] } = {}) {
  const invoke = vi.fn(async (model: string): Promise<ModelResult> => success(model));
  const flags = {
    enabled: (flag: string) => flag === 'FEATURE_MODEL_ROUTING'
      ? (options.routing ?? true)
      : flag === 'FEATURE_MODEL_FALLBACKS'
        ? (options.fallbacks ?? true)
        : false
  };
  const database = { recommendationSignals: vi.fn(async () => []) };
  const recommendations = {
    rank: vi.fn(() => (options.ranked ?? []).map((modelId, index) => ({ modelId, sampleCount: 20, rank: index + 1 })))
  };
  const privacy = { analyzePrompt: vi.fn(() => ({ intent: 'CODING' })) };
  const service = new RouterService(
    { invoke } as never,
    flags as never,
    privacy as never,
    database as never,
    recommendations as never
  );
  return { service, invoke };
}

describe('RouterService', () => {
  it('fails closed while routing is disabled', async () => {
    const { service, invoke } = createService({ routing: false });
    await expect(service.execute({ prompt: 'Explain code', models: ['a'] })).rejects.toMatchObject({ status: 503 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses deterministic evidence ranking when confidence is sufficient', async () => {
    const { service, invoke } = createService({ ranked: ['b', 'a'] });
    const response = await service.execute({ prompt: 'Explain code', models: ['a', 'b'] });
    expect(invoke).toHaveBeenCalledWith('b', 'Explain code', undefined, undefined, undefined, expect.objectContaining({ deadlineAt: expect.any(Number) }));
    expect(response).toMatchObject({
      status: 'SUCCESS', selectedModel: 'b', servedByModel: 'b', fallbackUsed: false,
      selection: { intent: 'CODING', reason: 'EVIDENCE_RANKED', policyVersion: 'router-v1' }
    });
  });

  it('falls back to the next eligible model and discloses the serving model', async () => {
    const { service, invoke } = createService();
    invoke.mockImplementation(async (model: string) => model === 'a' ? failure(model) : success(model));
    const response = await service.execute({ prompt: 'hello', models: ['a', 'b', 'c'] });
    expect(response).toMatchObject({
      status: 'SUCCESS', selectedModel: 'a', servedByModel: 'b', fallbackUsed: true,
      attempts: [{ model: 'a', status: 'FAILED' }, { model: 'b', status: 'SUCCESS' }]
    });
    expect(response.attempts[1]).not.toHaveProperty('response');
  });

  it('does not try another model while fallbacks are disabled', async () => {
    const { service, invoke } = createService({ fallbacks: false });
    invoke.mockImplementation(async (model: string) => failure(model));
    const response = await service.execute({ prompt: 'hello', models: ['a', 'b'] });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ status: 'FAILED', selectedModel: 'a', fallbackUsed: false });
    expect(response).not.toHaveProperty('result');
  });
});

