import { describe, expect, it } from 'vitest';
import { TokenGovernanceService } from '../token-governance.service.js';

describe('TokenGovernanceService', () => {
  it('does nothing when the feature is disabled', () => {
    const service = new TokenGovernanceService({ enabled: () => false } as never);
    const result = service.apply('x'.repeat(20_000), 8_000);
    expect(result).toMatchObject({ prompt: 'x'.repeat(20_000), maxTokens: 8_000, compacted: false });
  });

  it('caps and compacts oversized inference only when enabled', () => {
    const service = new TokenGovernanceService({ enabled: () => true } as never);
    const result = service.apply('x'.repeat(20_000), 8_000);
    expect(result.compacted).toBe(true);
    expect(result.maxTokens).toBe(2_048);
    expect(result.prompt.length).toBeLessThan(20_000);
  });

  it('never compacts evaluation inputs', () => {
    const prompt = 'x'.repeat(20_000);
    const service = new TokenGovernanceService({ enabled: () => true } as never);
    expect(service.apply(prompt, 8_000, 'EVALUATION')).toMatchObject({ prompt, maxTokens: 8_000, compacted: false });
  });
});
