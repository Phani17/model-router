import { describe, expect, it } from 'vitest';
import { DescriptorEmbeddingService } from '../descriptor-embedding.service.js';

describe('DescriptorEmbeddingService', () => {
  it('produces a stable vector from a fixed descriptor only', () => {
    const service = new DescriptorEmbeddingService();
    const descriptor = 'intent:CODING;freshness:STABLE;length:SHORT;sensitivity:NONE';
    expect(service.create(descriptor)).toEqual(service.create(descriptor));
    expect(service.create(descriptor)).toHaveLength(1536);
    expect(JSON.stringify(service.create(descriptor))).not.toContain('CODING');
  });
});
