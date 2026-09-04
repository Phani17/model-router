import crypto from 'node:crypto';
import { InferenceService } from './inference-service.js';
import type {
  ComparisonProgressEvent,
  ComparisonRequest,
  ComparisonResponse,
  ModelResult
} from '../models/inference.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { EvaluationService } from '../evals/evaluation.service.js';
import { FeatureFlagsService } from '../config/feature-flags.service.js';
import { PrivacyAnalysisService } from '../privacy/privacy-analysis.service.js';
import { DescriptorEmbeddingService } from '../privacy/descriptor-embedding.service.js';
import { FingerprintService } from '../cache/fingerprint.service.js';
import { InFlightDeduplicationService } from '../cache/in-flight-deduplication.service.js';
import { TtlPolicyService } from '../cache/ttl-policy.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { RequestIdentity } from '../auth/auth.types.js';

@Injectable()
export class ComparisonService {
  constructor(
    @Inject(InferenceService) private readonly inference: InferenceService,
    @Optional() @Inject(EvaluationService) private readonly evaluator?: EvaluationService,
    @Optional() @Inject(FeatureFlagsService) private readonly flags?: FeatureFlagsService,
    @Optional() @Inject(PrivacyAnalysisService) private readonly privacy?: PrivacyAnalysisService,
    @Optional() @Inject(DescriptorEmbeddingService) private readonly embeddings?: DescriptorEmbeddingService,
    @Optional() @Inject(FingerprintService) private readonly fingerprints?: FingerprintService,
    @Optional() @Inject(InFlightDeduplicationService) private readonly dedup?: InFlightDeduplicationService,
    @Optional() @Inject(TtlPolicyService) private readonly ttl?: TtlPolicyService,
    @Optional() @Inject(DatabaseService) private readonly database?: DatabaseService
  ) {}

  async compare(request: ComparisonRequest, identity = this.localIdentity()): Promise<ComparisonResponse> {
    const operation = () => this.runComparison(request, undefined, undefined, identity);
    if (!this.flags?.enabled('FEATURE_EXACT_CACHE') || !this.fingerprints || !this.dedup) return operation();
    const fingerprint = this.requestFingerprint(request, identity.tenantId);
    return this.dedup.run(fingerprint, operation);
  }

  async compareWithProgress(
    request: ComparisonRequest,
    emit: (event: ComparisonProgressEvent) => void,
    identity = this.localIdentity()
  ): Promise<ComparisonResponse> {
    const comparisonId = `cmp_${crypto.randomUUID()}`;
    emit({ type: 'comparison_started', comparisonId, models: request.models });
    return this.runComparison(request, comparisonId, emit, identity);
  }

  private async runComparison(
    request: ComparisonRequest,
    comparisonId = `cmp_${crypto.randomUUID()}`,
    emit?: (event: ComparisonProgressEvent) => void,
    identity = this.localIdentity()
  ): Promise<ComparisonResponse> {
    const settled = await Promise.allSettled(
      request.models.map(async model => {
        emit?.({ type: 'model_started', comparisonId, model });
        try {
          const result = await this.inference.invoke(
          model,
          request.prompt,
          request.temperature ?? 0.2,
          request.maxTokens ?? 1000,
          {
            onRetry: event => emit?.({
              type: 'model_retrying',
              comparisonId,
              ...event
            })
          }
          );
          this.emitModelResult(comparisonId, result, emit);
          return result;
        } catch (error) {
          const result: ModelResult = {
            model,
            status: 'FAILED',
            latencyMs: 0,
            error: 'Model invocation failed.'
          };
          this.emitModelResult(comparisonId, result, emit);
          return result;
        }
      })
    );

    const results = settled.map((item, index) => {
      if (item.status === 'fulfilled') return item.value;
      return {
        model: request.models[index],
        status: 'FAILED' as const,
        latencyMs: 0,
        error: 'Model invocation failed.'
      };
    });

    const successful = results.filter(result => result.status === 'SUCCESS').length;

    const analysis = this.privacy?.analyzePrompt(request.prompt);
    if (this.flags?.enabled('FEATURE_EVALS') && this.evaluator && analysis) {
      for (const result of results) {
        if (result.status !== 'SUCCESS' || !result.response) continue;
        const evaluation = this.evaluator.evaluate(request.prompt, result.response);
        result.evaluation = { passed: evaluation.passed, overall: evaluation.scores.overall, relevance: evaluation.scores.relevance, safety: evaluation.scores.safety };
        await this.database?.saveEvaluation({ tenantId: identity.tenantId, comparisonId, modelId: result.model, intent: analysis.intent, evaluation }).catch(() => undefined);
      }
    }
    if (analysis && this.flags?.enabled('FEATURE_SEMANTIC_CACHE') && this.database && this.embeddings && this.fingerprints && this.ttl) {
      const policy = this.ttl.forAnalysis(analysis);
      if (policy.eligible) {
        const fingerprint = this.requestFingerprint(request, identity.tenantId);
        this.privacy?.assertPersistenceSafe(analysis);
        await this.database.saveAnalysis({ tenantId: identity.tenantId, actorId: identity.actorId, fingerprint, analysis, embedding: this.embeddings.create(analysis.descriptor), expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000) }).catch(() => undefined);
      }
    }

    const comparison: ComparisonResponse = {
      comparisonId,
      status: successful === results.length
        ? 'COMPLETED'
        : successful > 0
          ? 'PARTIAL_FAILURE'
          : 'FAILED',
      results
    };

    emit?.({ type: 'comparison_completed', comparison });
    return comparison;
  }

  private requestFingerprint(request: ComparisonRequest, tenantId: string): string {
    return this.fingerprints!.create({ tenantId, prompt: request.prompt, model: [...request.models].sort().join(','), temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens ?? 1000, systemVersion: 'comparison-v1', guardrailVersion: 'strict-v1' });
  }

  private localIdentity(): RequestIdentity {
    return { actorId: 'anonymous-local', tenantId: 'local', roles: ['USER'], authType: 'LOCAL' };
  }

  private emitModelResult(
    comparisonId: string,
    result: ModelResult,
    emit?: (event: ComparisonProgressEvent) => void
  ) {
    emit?.({
      type: result.status === 'SUCCESS' ? 'model_completed' : 'model_failed',
      comparisonId,
      result
    });
  }
}
