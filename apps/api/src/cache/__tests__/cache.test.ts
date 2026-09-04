import { describe, expect, it, vi } from 'vitest';
import { FingerprintService } from '../fingerprint.service.js';
import { InFlightDeduplicationService } from '../in-flight-deduplication.service.js';

describe('privacy-safe execution reuse', () => {
  const fingerprint = new FingerprintService();
  const base = { tenantId: 'tenant-a', prompt: 'private canary', model: 'model-a', temperature: 0.2, maxTokens: 1000, systemVersion: '1', guardrailVersion: '1' };

  it('uses a tenant-scoped keyed fingerprint without exposing input', () => {
    const value = fingerprint.create(base);
    expect(value).not.toContain('private');
    expect(value).not.toBe(fingerprint.create({ ...base, tenantId: 'tenant-b' }));
  });

  it('deduplicates concurrent work and forgets it immediately after completion', async () => {
    const service = new InFlightDeduplicationService();
    let resolve!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>(done => { resolve = done; }));
    const first = service.run('fingerprint', operation);
    const second = service.run('fingerprint', operation);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(service.activeCount).toBe(1);
    resolve('transient response');
    await expect(Promise.all([first, second])).resolves.toEqual(['transient response', 'transient response']);
    expect(service.activeCount).toBe(0);
  });
});
