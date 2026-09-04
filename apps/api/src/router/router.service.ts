import crypto from 'node:crypto';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RequestIdentity } from '../auth/auth.types.js';
import { FeatureFlagsService } from '../config/feature-flags.service.js';
import { env } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import type { ModelResult } from '../models/inference.js';
import { PrivacyAnalysisService } from '../privacy/privacy-analysis.service.js';
import { RecommendationService } from '../recommendations/recommendation.service.js';
import { InferenceService } from '../services/inference-service.js';
import type { RouterRequestDto } from './dto/router-request.dto.js';
import type { RouterResponse, RoutingAttempt } from './router.types.js';

@Injectable()
export class RouterService {
  private readonly allowedModels = new Set(
    env.ROUTER_ALLOWED_MODELS.split(',').map(value => value.trim()).filter(Boolean)
  );

  constructor(
    @Inject(InferenceService) private readonly inference: InferenceService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(PrivacyAnalysisService) private readonly privacy: PrivacyAnalysisService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RecommendationService) private readonly recommendations: RecommendationService
  ) {}

  async execute(
    request: RouterRequestDto,
    identity: RequestIdentity = { actorId: 'anonymous-local', tenantId: 'local', roles: ['USER'], authType: 'LOCAL' }
  ): Promise<RouterResponse> {
    if (!this.flags.enabled('FEATURE_MODEL_ROUTING')) {
      throw new ServiceUnavailableException({ error: 'FEATURE_DISABLED', feature: 'MODEL_ROUTING' });
    }

    this.assertAllowed(request.models);
    const analysis = this.privacy.analyzePrompt(request.prompt);
    const selection = await this.selectModels(request.models, identity.tenantId, analysis.intent);
    const fallbacksEnabled = this.flags.enabled('FEATURE_MODEL_FALLBACKS');
    const executionOrder = selection.models.slice(0, fallbacksEnabled ? 1 + env.ROUTER_MAX_FALLBACKS : 1);
    const deadlineAt = Date.now() + env.ROUTER_TOTAL_DEADLINE_MS;
    const attempts: RoutingAttempt[] = [];
    let finalResult: ModelResult | undefined;

    for (const model of executionOrder) {
      if (Date.now() >= deadlineAt) break;
      const result = await this.inference.invoke(
        model,
        request.prompt,
        request.temperature,
        request.maxTokens,
        undefined,
        { deadlineAt }
      );
      attempts.push(this.attemptMetadata(result));
      if (result.status === 'SUCCESS') {
        finalResult = result;
        break;
      }
    }

    return {
      routingId: `route_${crypto.randomUUID()}`,
      status: finalResult ? 'SUCCESS' : 'FAILED',
      requestedModels: [...request.models],
      selectedModel: executionOrder[0]!,
      servedByModel: finalResult?.model,
      fallbackUsed: Boolean(finalResult && finalResult.model !== executionOrder[0]),
      selection: {
        intent: analysis.intent,
        reason: selection.reason,
        policyVersion: 'router-v1'
      },
      attempts,
      ...(finalResult ? { result: finalResult } : {})
    };
  }

  private assertAllowed(models: string[]): void {
    if (this.allowedModels.size === 0) return;
    const denied = models.filter(model => !this.allowedModels.has(model));
    if (denied.length > 0) {
      throw new BadRequestException({ error: 'MODEL_NOT_ALLOWED', models: denied });
    }
  }

  private async selectModels(models: string[], tenantId: string, intent: string): Promise<{
    models: string[];
    reason: RouterResponse['selection']['reason'];
  }> {
    const signals = await this.database.recommendationSignals(tenantId, intent).catch(() => []);
    const ranked = this.recommendations.rank(signals)
      .filter(value => models.includes(value.modelId) && value.sampleCount >= env.ROUTER_MIN_EVIDENCE_SAMPLES);
    if (ranked.length > 0) {
      const rankedIds = ranked.map(value => value.modelId);
      return { models: [...rankedIds, ...models.filter(model => !rankedIds.includes(model))], reason: 'EVIDENCE_RANKED' };
    }
    if (env.ROUTER_DEFAULT_MODEL && models.includes(env.ROUTER_DEFAULT_MODEL)) {
      return {
        models: [env.ROUTER_DEFAULT_MODEL, ...models.filter(model => model !== env.ROUTER_DEFAULT_MODEL)],
        reason: 'CONFIGURED_DEFAULT'
      };
    }
    return { models: [...models], reason: 'REQUEST_ORDER' };
  }

  private attemptMetadata(result: ModelResult): RoutingAttempt {
    return {
      model: result.model,
      status: result.status,
      latencyMs: result.latencyMs,
      attempts: result.attempts ?? 1,
      retryCount: result.retryCount ?? 0,
      error: result.error
    };
  }
}

