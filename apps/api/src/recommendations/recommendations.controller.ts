import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RequestIdentity } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { RecommendationService } from './recommendation.service.js';

@Controller('api/v1/recommendations')
export class RecommendationsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(RecommendationService) private readonly recommendations: RecommendationService) {}

  @Get()
  async list(@Query('intent') value: string | undefined, @Req() request: FastifyRequest & { identity?: RequestIdentity }) {
    const intent = z.enum(['ANALYSIS', 'CODING', 'CREATIVE', 'FACTUAL', 'GENERAL']).catch('GENERAL').parse(value);
    const tenantId = request.identity?.tenantId ?? 'local';
    return { intent, recommendations: this.recommendations.rank(await this.database.recommendationSignals(tenantId, intent)) };
  }
}
