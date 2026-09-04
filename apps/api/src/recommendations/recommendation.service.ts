import { Inject, Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../config/feature-flags.service.js';

export interface RecommendationSignal {
  modelId: string;
  qualityScore: number;
  latencyMsP50?: number;
  costMicrosP50?: number;
  sampleCount: number;
}

export interface ModelRecommendation extends RecommendationSignal {
  rank: number;
  score: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

@Injectable()
export class RecommendationService {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  rank(signals: RecommendationSignal[]): ModelRecommendation[] {
    if (!this.flags.enabled('FEATURE_RECOMMENDATIONS')) return [];
    const maxLatency = Math.max(1, ...signals.map(value => value.latencyMsP50 ?? 0));
    const maxCost = Math.max(1, ...signals.map(value => value.costMicrosP50 ?? 0));
    return signals
      .map(signal => {
        const latencyScore = signal.latencyMsP50 === undefined ? 0.5 : 1 - signal.latencyMsP50 / maxLatency;
        const costScore = signal.costMicrosP50 === undefined ? 0.5 : 1 - signal.costMicrosP50 / maxCost;
        const confidenceFactor = Math.min(1, signal.sampleCount / 20);
        const score = (signal.qualityScore * 0.65 + latencyScore * 0.2 + costScore * 0.15) * (0.7 + confidenceFactor * 0.3);
        return {
          ...signal,
          rank: 0,
          score: Math.round(score * 1000) / 1000,
          confidence: signal.sampleCount >= 20 ? 'HIGH' as const : signal.sampleCount >= 5 ? 'MEDIUM' as const : 'LOW' as const,
          reasons: [
            `quality:${signal.qualityScore.toFixed(2)}`,
            signal.latencyMsP50 === undefined ? 'latency:unknown' : `latency-p50:${signal.latencyMsP50}ms`,
            signal.costMicrosP50 === undefined ? 'cost:unknown' : `cost-p50:${signal.costMicrosP50}µ`
          ]
        };
      })
      .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId))
      .map((value, index) => ({ ...value, rank: index + 1 }));
  }
}
