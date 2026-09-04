import { Global, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { TokenBucketRateLimiter } from '../services/rate-limiter.js';
import { RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SECOND } from './rate-limit.constants.js';
import { ComparisonRateLimitGuard, InferenceRateLimitGuard } from './rate-limit.guard.js';

@Global()
@Module({
  providers: [
    { provide: RATE_LIMIT_CAPACITY, useValue: env.RATE_LIMIT_CAPACITY },
    { provide: RATE_LIMIT_REFILL_PER_SECOND, useValue: env.RATE_LIMIT_REFILL_PER_SECOND },
    TokenBucketRateLimiter,
    InferenceRateLimitGuard,
    ComparisonRateLimitGuard
  ],
  exports: [TokenBucketRateLimiter, InferenceRateLimitGuard, ComparisonRateLimitGuard]
})
export class RateLimitModule {}
