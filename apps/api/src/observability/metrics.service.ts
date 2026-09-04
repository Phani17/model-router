import { Inject, Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../config/feature-flags.service.js';

interface ModelMetrics {
  requests: number;
  successes: number;
  failures: number;
  latencyMsTotal: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
}

@Injectable()
export class MetricsService {
  private readonly models = new Map<string, ModelMetrics>();

  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  record(input: { model: string; success: boolean; latencyMs: number; inputTokens?: number; outputTokens?: number; retries?: number }): void {
    if (!this.flags.enabled('FEATURE_OBSERVABILITY')) return;
    const model = /^[A-Za-z0-9._:/-]{1,128}$/.test(input.model) ? input.model : 'invalid-model-id';
    const current = this.models.get(model) ?? { requests: 0, successes: 0, failures: 0, latencyMsTotal: 0, inputTokens: 0, outputTokens: 0, retries: 0 };
    current.requests += 1;
    current.successes += input.success ? 1 : 0;
    current.failures += input.success ? 0 : 1;
    current.latencyMsTotal += Math.max(0, input.latencyMs);
    current.inputTokens += Math.max(0, input.inputTokens ?? 0);
    current.outputTokens += Math.max(0, input.outputTokens ?? 0);
    current.retries += Math.max(0, input.retries ?? 0);
    this.models.set(model, current);
  }

  snapshot() {
    return [...this.models.entries()].map(([model, value]) => ({
      model,
      ...value,
      averageLatencyMs: value.requests === 0 ? 0 : Math.round(value.latencyMsTotal / value.requests)
    }));
  }
}
