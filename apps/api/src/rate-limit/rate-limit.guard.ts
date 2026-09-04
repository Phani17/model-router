import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { comparisonRequestSchema } from '../comparison/dto/comparison-request.dto.js';
import { inferenceRequestSchema } from '../inference/dto/inference-request.dto.js';
import { FeatureFlagsService } from '../config/feature-flags.service.js';
import { env } from '../config/env.js';
import { routerRequestSchema } from '../router/dto/router-request.dto.js';
import {
  TokenBucketRateLimiter,
  type RateLimitDecision
} from '../services/rate-limiter.js';

abstract class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: TokenBucketRateLimiter) {}

  protected abstract cost(body: unknown): number | undefined;

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const cost = this.cost(request.body);

    // Nest guards run before parameter pipes. Returning here lets the DTO pipe
    // produce the same 400 response without charging malformed requests.
    if (cost === undefined) return true;

    const decision = this.limiter.consume(request.ip, cost);
    this.setHeaders(reply, decision);

    if (!decision.allowed) {
      throw new HttpException({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Inference rate limit exceeded. Retry after the indicated delay.',
        retryAfterSeconds: decision.retryAfterSeconds
      }, 429);
    }

    return true;
  }

  private setHeaders(reply: FastifyReply, decision: RateLimitDecision) {
    reply.header('RateLimit-Limit', decision.limit);
    reply.header('RateLimit-Remaining', decision.remaining);
    reply.header('RateLimit-Reset', decision.resetAfterSeconds);
    if (!decision.allowed) {
      reply.header('Retry-After', decision.retryAfterSeconds);
    }
  }
}

@Injectable()
export class InferenceRateLimitGuard extends RateLimitGuard {
  constructor(@Inject(TokenBucketRateLimiter) limiter: TokenBucketRateLimiter) {
    super(limiter);
  }

  protected cost(body: unknown): number | undefined {
    return inferenceRequestSchema.safeParse(body).success ? 1 : undefined;
  }
}

@Injectable()
export class ComparisonRateLimitGuard extends RateLimitGuard {
  constructor(@Inject(TokenBucketRateLimiter) limiter: TokenBucketRateLimiter) {
    super(limiter);
  }

  protected cost(body: unknown): number | undefined {
    const parsed = comparisonRequestSchema.safeParse(body);
    return parsed.success ? parsed.data.models.length : undefined;
  }
}

@Injectable()
export class RouterRateLimitGuard extends RateLimitGuard {
  constructor(
    @Inject(TokenBucketRateLimiter) limiter: TokenBucketRateLimiter,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {
    super(limiter);
  }

  protected cost(body: unknown): number | undefined {
    if (!this.flags.enabled('FEATURE_MODEL_ROUTING')) return undefined;
    const parsed = routerRequestSchema.safeParse(body);
    if (!parsed.success) return undefined;
    return this.flags.enabled('FEATURE_MODEL_FALLBACKS')
      ? Math.min(parsed.data.models.length, 1 + env.ROUTER_MAX_FALLBACKS)
      : 1;
  }
}
