import { Module } from '@nestjs/common';
import { ComparisonModule } from './comparison/comparison.module.js';
import { HealthModule } from './health/health.module.js';
import { InferenceModule } from './inference/inference.module.js';
import { ModelsModule } from './models/models.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { GuardrailsModule } from './guardrails/guardrails.module.js';
import { DatabaseModule } from './database/database.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { ConfigModule } from './config/config.module.js';
import { CacheModule } from './cache/cache.module.js';
import { EvalsModule } from './evals/evals.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RouterModule } from './router/router.module.js';

@Module({
  imports: [ConfigModule, AuthModule, DatabaseModule, CacheModule, PrivacyModule, EvalsModule, GovernanceModule, ObservabilityModule, RecommendationsModule, GuardrailsModule, RateLimitModule, HealthModule, InferenceModule, ModelsModule, ComparisonModule, RouterModule]
})
export class AppModule {}
