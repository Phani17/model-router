import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { InferenceClient, InferenceClientError } from '../inference-client.js';

describe('InferenceClient DigitalOcean contract', () => {
  const originalKey = env.DIGITALOCEAN_MODEL_ACCESS_KEY;
  const originalBaseUrl = env.DIGITALOCEAN_INFERENCE_BASE_URL;

  beforeEach(() => {
    env.DIGITALOCEAN_MODEL_ACCESS_KEY = 'test-key';
    env.DIGITALOCEAN_INFERENCE_BASE_URL = 'https://inference.example.test/';
  });

  afterEach(() => {
    env.DIGITALOCEAN_MODEL_ACCESS_KEY = originalKey;
    env.DIGITALOCEAN_INFERENCE_BASE_URL = originalBaseUrl;
    vi.unstubAllGlobals();
  });

  it('normalizes the provider model catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-a', owned_by: 'provider-a' }, { id: 'model-b' }]
    }), { status: 200 })));

    await expect(new InferenceClient().listModels()).resolves.toEqual([
      { id: 'model-a', name: 'model-a', ownedBy: 'provider-a' },
      { id: 'model-b', name: 'model-b', ownedBy: undefined }
    ]);
  });

  it('sends an OpenAI-compatible chat request and maps token usage', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new InferenceClient().chat('model-a', 'prompt', 0.7, 123);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://inference.example.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    const options = fetchMock.mock.calls[0]![1]!;
    expect(options.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(String(options.body))).toEqual({
      model: 'model-a',
      messages: [{ role: 'user', content: 'prompt' }],
      temperature: 0.7,
      max_tokens: 123
    });
    expect(result).toEqual({ text: 'hello', inputTokens: 11, outputTokens: 7 });
  });

  it('classifies provider errors and honors Retry-After seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', {
      status: 429,
      headers: { 'Retry-After': '2' }
    })));

    const error = await new InferenceClient().chat('model-a', 'prompt').catch(value => value);

    expect(error).toBeInstanceOf(InferenceClientError);
    expect(error).toMatchObject({ statusCode: 429, retryable: true, retryAfterMs: 2000 });
    expect(error.message).toContain('HTTP 429: busy');
  });

  it('classifies network failures as retryable without hiding the cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset'); }));

    const error = await new InferenceClient().chat('model-a', 'prompt').catch(value => value);

    expect(error).toBeInstanceOf(InferenceClientError);
    expect(error).toMatchObject({ retryable: true });
    expect(error.message).toContain('connection reset');
  });

  it('fails locally when the server-side access key is missing', async () => {
    env.DIGITALOCEAN_MODEL_ACCESS_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new InferenceClient().chat('model-a', 'prompt')).rejects.toMatchObject({
      statusCode: 401,
      retryable: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
