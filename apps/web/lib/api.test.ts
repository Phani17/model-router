import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComparisonProgressEvent } from '@model-router/shared';
import { ApiError, compareWithProgress, getFeatures, getModels } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('frontend API client', () => {
  it('loads models through the same-origin backend proxy', async () => {
    const fetchMock = vi.fn(async () => Response.json({ models: [{ id: 'model-a' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getModels()).resolves.toEqual([{ id: 'model-a' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/backend/api/v1/models', expect.objectContaining({ cache: 'no-store' }));
  });

  it('loads public feature states without exposing server configuration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ evals: true, tokenCostGovernance: false })));
    await expect(getFeatures()).resolves.toMatchObject({ evals: true, tokenCostGovernance: false });
  });

  it('consumes comparison progress from the SSE route', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: comparison_started\ndata: {"type":"comparison_started","comparisonId":"cmp_1","models":["a","b"]}\n\n'));
        controller.close();
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })));
    const events: ComparisonProgressEvent[] = [];

    await compareWithProgress({ prompt: 'hello', models: ['a', 'b'] }, event => events.push(event));

    expect(events).toEqual([{ type: 'comparison_started', comparisonId: 'cmp_1', models: ['a', 'b'] }]);
  });

  it('falls back to the synchronous comparison endpoint when streaming is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        comparisonId: 'cmp_2', status: 'COMPLETED', results: [
          { model: 'a', status: 'SUCCESS', response: 'A', latencyMs: 10 },
          { model: 'b', status: 'SUCCESS', response: 'B', latencyMs: 20 }
        ]
      }));
    vi.stubGlobal('fetch', fetchMock);
    const events: ComparisonProgressEvent[] = [];

    await compareWithProgress({ prompt: 'hello', models: ['a', 'b'] }, event => events.push(event));

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/backend/api/v1/comparisons', expect.objectContaining({ method: 'POST' }));
    expect(events.map(event => event.type)).toEqual([
      'comparison_started', 'model_completed', 'model_completed', 'comparison_completed'
    ]);
  });

  it('retains structured retry timing from a rate-limit response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      message: 'Inference rate limit exceeded.', retryAfterSeconds: 4
    }, { status: 429, headers: { 'Retry-After': '4' } })));

    const error = await getModels().catch(value => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 4 });
  });
});
