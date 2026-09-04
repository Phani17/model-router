import { describe, expect, it } from 'vitest';
import { PrivacyAnalysisService } from '../privacy-analysis.service.js';

describe('PrivacyAnalysisService', () => {
  const service = new PrivacyAnalysisService();

  it('produces only fixed-vocabulary prompt signals', () => {
    const canary = 'customer-private-canary-847291';
    const analysis = service.analyzePrompt(`Compare API designs for ${canary}`);
    expect(analysis).toMatchObject({ intent: 'CODING', lengthBucket: 'SHORT' });
    expect(JSON.stringify(analysis)).not.toContain(canary);
    expect(() => service.assertPersistenceSafe(analysis)).not.toThrow();
  });

  it('labels sensitivity without retaining matched content', () => {
    const email = 'private.person@example.test';
    const analysis = service.analyzePrompt(`Contact ${email} with the analysis`);
    expect(analysis.sensitivityLabels).toContain('EMAIL');
    expect(JSON.stringify(analysis)).not.toContain(email);
  });

  it('reduces outputs to non-content metrics', () => {
    const canary = 'private-model-output-canary';
    const analysis = service.analyzeOutput(`Result ${canary} with https://example.test`);
    expect(analysis.hasCitations).toBe(true);
    expect(JSON.stringify(analysis)).not.toContain(canary);
  });

  it('rejects sensitive values at the persistence boundary', () => {
    expect(() => service.assertPersistenceSafe({ value: 'sk_abcdefghijklmnopqrstuvwxyz' })).toThrow(
      'prohibited sensitive material'
    );
  });
});
