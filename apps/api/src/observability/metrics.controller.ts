import { Controller, Get, Inject } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';
import { Roles } from '../auth/auth.decorators.js';

@Controller('api/v1/metrics')
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get()
  @Roles('EVALUATOR', 'ADMIN')
  getMetrics() {
    return { models: this.metrics.snapshot() };
  }
}
