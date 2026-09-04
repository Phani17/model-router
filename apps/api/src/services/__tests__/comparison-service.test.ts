import { describe, expect, it, vi } from 'vitest';
import { ComparisonService } from '../comparison-service.js';
import type { InferenceService } from '../inference-service.js';
import { EvaluationService } from '../../evals/evaluation.service.js';
import { PrivacyAnalysisService } from '../../privacy/privacy-analysis.service.js';

function createInferenceMock(
  impl: (model: string) => Promise<{
    model: string;
    status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
    latencyMs: number;
    response?: string;
    error?: string;
  }>
): InferenceService {
  return {
    invoke: vi.fn((model: string) => impl(model))
  } as unknown as InferenceService;
}

describe('ComparisonService', () => {
  it('invokes all selected models concurrently and returns COMPLETED', async () => {
    let active = 0;
    let maxActive = 0;

    const inference = createInferenceMock(async model => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active -= 1;
      return {
        model,
        status: 'SUCCESS',
        latencyMs: 25,
        response: `response from ${model}`
      };
    });

    const service = new ComparisonService(inference);
    const result = await service.compare({
      prompt: 'Explain sharding',
      models: ['model-a', 'model-b', 'model-c']
    });

    expect(maxActive).toBeGreaterThan(1);
    expect(result.status).toBe('COMPLETED');
    expect(result.results).toHaveLength(3);
    expect(result.results.every(item => item.status === 'SUCCESS')).toBe(true);
    expect(result.comparisonId).toMatch(/^cmp_/);
  });

  it('returns PARTIAL_FAILURE without discarding successful model results', async () => {
    const inference = createInferenceMock(async model => {
      if (model === 'model-b') {
        return {
          model,
          status: 'FAILED',
          latencyMs: 10,
          error: 'rate limited'
        };
      }

      return {
        model,
        status: 'SUCCESS',
        latencyMs: 10,
        response: `response from ${model}`
      };
    });

    const service = new ComparisonService(inference);
    const result = await service.compare({
      prompt: 'Compare these models',
      models: ['model-a', 'model-b', 'model-c']
    });

    expect(result.status).toBe('PARTIAL_FAILURE');
    expect(result.results.map(item => item.status)).toEqual([
      'SUCCESS',
      'FAILED',
      'SUCCESS'
    ]);
    expect(result.results[1]).toMatchObject({
      model: 'model-b',
      error: 'rate limited'
    });
  });

  it('converts a rejected invocation into a failed result', async () => {
    const inference = {
      invoke: vi.fn(async (model: string) => {
        if (model === 'model-b') throw new Error('unexpected provider error');
        return {
          model,
          status: 'SUCCESS' as const,
          latencyMs: 5,
          response: 'ok'
        };
      })
    } as unknown as InferenceService;

    const service = new ComparisonService(inference);
    const result = await service.compare({
      prompt: 'test',
      models: ['model-a', 'model-b']
    });

    expect(result.status).toBe('PARTIAL_FAILURE');
    expect(result.results[1]).toEqual({
      model: 'model-b',
      status: 'FAILED',
      latencyMs: 0,
      error: 'Model invocation failed.'
    });
  });

  it('emits incremental progress while models still run concurrently', async () => {
    const inference = createInferenceMock(async model => {
      await new Promise(resolve => setTimeout(resolve, model === 'model-a' ? 20 : 5));
      return { model, status: 'SUCCESS', latencyMs: 5, response: 'ok' };
    });
    const service = new ComparisonService(inference);
    const events: Array<{ type: string; model?: string; result?: { model: string } }> = [];

    const result = await service.compareWithProgress(
      { prompt: 'hello', models: ['model-a', 'model-b'] },
      event => events.push(event)
    );

    expect(events[0]?.type).toBe('comparison_started');
    expect(events.filter(event => event.type === 'model_started')).toHaveLength(2);
    expect(events.filter(event => event.type === 'model_completed').map(event => event.result?.model))
      .toEqual(['model-b', 'model-a']);
    expect(events.at(-1)?.type).toBe('comparison_completed');
    expect(result.status).toBe('COMPLETED');
  });

  it('forwards per-model retry events into comparison progress', async () => {
    const inference = {
      invoke: vi.fn(async (
        model: string,
        _prompt: string,
        _temperature: number,
        _maxTokens: number,
        progress?: { onRetry(event: { model: string; nextAttempt: number; delayMs: number; reason: string }): void }
      ) => {
        progress?.onRetry({ model, nextAttempt: 2, delayMs: 50, reason: 'busy' });
        return { model, status: 'SUCCESS' as const, latencyMs: 10, response: 'ok' };
      })
    } as unknown as InferenceService;
    const events: Array<{ type: string; model?: string; nextAttempt?: number }> = [];

    await new ComparisonService(inference).compareWithProgress(
      { prompt: 'hello', models: ['model-a', 'model-b'] },
      event => events.push(event)
    );

    expect(events.filter(event => event.type === 'model_retrying')).toEqual([
      expect.objectContaining({ model: 'model-a', nextAttempt: 2 }),
      expect.objectContaining({ model: 'model-b', nextAttempt: 2 })
    ]);
  });

  it('returns derived evaluation scores without persisting response content', async () => {
    const inference = createInferenceMock(async model => ({ model, status: 'SUCCESS', latencyMs: 2, response: 'Sharding partitions data across nodes.' }));
    const flags = { enabled: (flag: string) => flag === 'FEATURE_EVALS' };
    const database = { saveEvaluation: vi.fn(async () => undefined) };
    const service = new ComparisonService(inference, new EvaluationService(), flags as never, new PrivacyAnalysisService(), undefined, undefined, undefined, undefined, database as never);
    const result = await service.compare({ prompt: 'Explain sharding', models: ['a', 'b'] });

    expect(result.results[0]?.evaluation).toEqual(expect.objectContaining({ safety: 1 }));
    expect(database.saveEvaluation).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(database.saveEvaluation.mock.calls)).not.toContain('Sharding partitions data');
  });
});
