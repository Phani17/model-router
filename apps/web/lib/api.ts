import type {
  ComparisonProgressEvent,
  ComparisonRequest,
  ComparisonResponse,
  ModelInfo
} from '@model-router/shared';
import { parseSseStream } from './sse';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PublicFeatures {
  tokenCostGovernance: boolean;
  exactCache: boolean;
  semanticCache: boolean;
  evals: boolean;
  observability: boolean;
  recommendations: boolean;
}

async function toApiError(response: Response) {
  const body = await response.json().catch(() => ({})) as {
    message?: string;
    retryAfterSeconds?: number;
  };
  const retryAfter = body.retryAfterSeconds ?? (Number(response.headers.get('retry-after')) || undefined);
  return new ApiError(body.message ?? `Request failed with HTTP ${response.status}`, response.status, retryAfter);
}

export async function getModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const response = await fetch('/api/backend/api/v1/models', { cache: 'no-store', signal });
  if (!response.ok) throw await toApiError(response);
  const body = await response.json() as { models: ModelInfo[] };
  return body.models;
}

export async function getFeatures(signal?: AbortSignal): Promise<PublicFeatures> {
  const response = await fetch('/api/backend/api/v1/features', { cache: 'no-store', signal });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<PublicFeatures>;
}

export async function compareSynchronously(
  request: ComparisonRequest,
  signal?: AbortSignal
): Promise<ComparisonResponse> {
  const response = await fetch('/api/backend/api/v1/comparisons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<ComparisonResponse>;
}

export async function compareWithProgress(
  request: ComparisonRequest,
  onEvent: (event: ComparisonProgressEvent) => void,
  signal?: AbortSignal
) {
  const response = await fetch('/api/backend/api/v1/comparisons/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(request),
    signal
  });

  if (response.status === 404 || response.status === 405) {
    const comparison = await compareSynchronously(request, signal);
    onEvent({ type: 'comparison_started', comparisonId: comparison.comparisonId, models: request.models });
    comparison.results.forEach(result => onEvent({
      type: result.status === 'SUCCESS' ? 'model_completed' : 'model_failed',
      comparisonId: comparison.comparisonId,
      result
    }));
    onEvent({ type: 'comparison_completed', comparison });
    return;
  }

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError('The comparison stream was empty.', 502);
  await parseSseStream<ComparisonProgressEvent>(response.body, message => onEvent(message.data));
}
