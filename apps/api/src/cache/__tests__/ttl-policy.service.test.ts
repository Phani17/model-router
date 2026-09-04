import { describe, expect, it } from 'vitest';
import { PrivacyAnalysisService } from '../../privacy/privacy-analysis.service.js';
import { TtlPolicyService } from '../ttl-policy.service.js';

describe('TtlPolicyService', () => {
  const privacy = new PrivacyAnalysisService();
  const policy = new TtlPolicyService();

  it('bypasses reuse for sensitive workloads', () => {
    expect(policy.forAnalysis(privacy.analyzePrompt('Email person@example.test')).eligible).toBe(false);
  });

  it('uses a short TTL for current information', () => {
    expect(policy.forAnalysis(privacy.analyzePrompt('What is the latest news?'))).toMatchObject({
      eligible: true,
      ttlSeconds: 300,
      reason: 'CURRENT'
    });
  });

  it('uses a longer TTL only for explicitly stable knowledge', () => {
    expect(policy.forAnalysis(privacy.analyzePrompt('Explain this definition'))).toMatchObject({
      ttlSeconds: 2_592_000,
      reason: 'STABLE'
    });
  });
});
