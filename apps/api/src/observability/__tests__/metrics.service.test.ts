import { describe, expect, it } from 'vitest';
import { MetricsService } from '../metrics.service.js';

describe('MetricsService', () => {
  it('is inert while disabled', () => {
    const service = new MetricsService({ enabled: () => false } as never);
    service.record({ model: 'model-a', success: true, latencyMs: 10 });
    expect(service.snapshot()).toEqual([]);
  });

  it('retains numeric operational signals only', () => {
    const service = new MetricsService({ enabled: () => true } as never);
    service.record({ model: 'model-a', success: true, latencyMs: 10, inputTokens: 5, outputTokens: 7, retries: 1 });
    expect(service.snapshot()).toEqual([{ model: 'model-a', requests: 1, successes: 1, failures: 0, latencyMsTotal: 10, inputTokens: 5, outputTokens: 7, retries: 1, averageLatencyMs: 10 }]);
  });
});
