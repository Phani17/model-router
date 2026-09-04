export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_REFILL_PER_SECOND
} from '../rate-limit/rate-limit.constants.js';

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

/**
 * In-memory token bucket used by the PoC to protect inference fan-out.
 *
 * Capacity is expressed in model-invocation units rather than HTTP requests.
 * For example, comparing four models costs four units.
 *
 * Production note: this state is process-local. A horizontally scaled service
 * should move the bucket state to a distributed store/gateway (for example
 * Redis or an API gateway) so all replicas enforce the same quota.
 */
@Injectable()
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    @Inject(RATE_LIMIT_CAPACITY) private readonly capacity: number,
    @Inject(RATE_LIMIT_REFILL_PER_SECOND) private readonly refillTokensPerSecond: number,
    @Optional() @Inject(RATE_LIMIT_CLOCK) private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error('Rate-limit capacity must be greater than zero');
    }
    if (!Number.isFinite(refillTokensPerSecond) || refillTokensPerSecond <= 0) {
      throw new Error('Rate-limit refill rate must be greater than zero');
    }
  }

  consume(key: string, cost = 1): RateLimitDecision {
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new Error('Rate-limit cost must be greater than zero');
    }

    const now = this.now();
    const bucket = this.refill(this.buckets.get(key), now);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return this.decision(true, bucket.tokens, 0);
    }

    this.buckets.set(key, bucket);
    const missingTokens = cost - bucket.tokens;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(missingTokens / this.refillTokensPerSecond)
    );

    return this.decision(false, bucket.tokens, retryAfterSeconds);
  }

  private refill(existing: Bucket | undefined, now: number): Bucket {
    if (!existing) {
      return { tokens: this.capacity, lastRefillMs: now };
    }

    const elapsedSeconds = Math.max(0, now - existing.lastRefillMs) / 1000;
    return {
      tokens: Math.min(
        this.capacity,
        existing.tokens + elapsedSeconds * this.refillTokensPerSecond
      ),
      lastRefillMs: now
    };
  }

  private decision(
    allowed: boolean,
    tokens: number,
    retryAfterSeconds: number
  ): RateLimitDecision {
    const resetAfterSeconds = Math.ceil(
      Math.max(0, this.capacity - tokens) / this.refillTokensPerSecond
    );

    return {
      allowed,
      limit: this.capacity,
      remaining: Math.max(0, Math.floor(tokens)),
      retryAfterSeconds,
      resetAfterSeconds
    };
  }
}
