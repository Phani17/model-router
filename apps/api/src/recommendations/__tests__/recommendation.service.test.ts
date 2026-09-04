import { describe, expect, it } from 'vitest';
import { RecommendationService } from '../recommendation.service.js';

describe('RecommendationService', () => {
  const signals = [
    { modelId: 'quality-model', qualityScore: 0.95, latencyMsP50: 800, costMicrosP50: 50, sampleCount: 25 },
    { modelId: 'fast-model', qualityScore: 0.7, latencyMsP50: 100, costMicrosP50: 10, sampleCount: 25 }
  ];

  it('returns no recommendations while disabled', () => {
    expect(new RecommendationService({ enabled: () => false } as never).rank(signals)).toEqual([]);
  });

  it('ranks using aggregate signals with explainable reasons', () => {
    const ranked = new RecommendationService({ enabled: () => true } as never).rank(signals);
    expect(ranked.map(value => value.rank)).toEqual([1, 2]);
    expect(ranked[0].confidence).toBe('HIGH');
    expect(ranked[0].reasons).toHaveLength(3);
  });
});
