import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter } from '../rate-limiter.js';
import { RATE_LIMIT_CLOCK } from '../../rate-limit/rate-limit.constants.js';

describe('TokenBucketRateLimiter', () => {
  it('uses an explicit optional injection token for the clock dependency', () => {
    const injected = Reflect.getMetadata('self:paramtypes', TokenBucketRateLimiter) as Array<{
      index: number;
      param: symbol;
    }>;

    expect(injected).toContainEqual({ index: 2, param: RATE_LIMIT_CLOCK });
  });

  it('charges comparisons by downstream model count', () => {
    const limiter = new TokenBucketRateLimiter(5, 1, () => 0);

    const first = limiter.consume('client-a', 4);
    const second = limiter.consume('client-a', 2);

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: false, remaining: 1 });
  });

  it('refills tokens over time', () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter(4, 1, () => now);

    expect(limiter.consume('client-a', 4).allowed).toBe(true);
    expect(limiter.consume('client-a', 1).allowed).toBe(false);

    now = 2_000;
    const afterRefill = limiter.consume('client-a', 2);

    expect(afterRefill).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('returns a retry delay when quota is exhausted', () => {
    const limiter = new TokenBucketRateLimiter(4, 2, () => 0);

    limiter.consume('client-a', 4);
    const denied = limiter.consume('client-a', 2);

    expect(denied).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1
    });
  });

  it('keeps independent buckets for different clients', () => {
    const limiter = new TokenBucketRateLimiter(3, 1, () => 0);

    expect(limiter.consume('client-a', 3).allowed).toBe(true);
    expect(limiter.consume('client-a', 1).allowed).toBe(false);
    expect(limiter.consume('client-b', 3).allowed).toBe(true);
  });
});
