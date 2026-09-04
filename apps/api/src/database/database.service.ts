import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import crypto from 'node:crypto';
import type { SafePromptAnalysis } from '../privacy/privacy-analysis.service.js';
import type { EvaluationResult } from '../evals/evaluation.service.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly enabled = env.DATABASE_ENABLED;
  private readonly pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

  async onModuleInit(): Promise<void> {
    if (this.enabled) await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.enabled) await this.pool.end();
  }

  async ready(): Promise<boolean> {
    if (!this.enabled) return true;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
    if (!this.enabled) return [];
    const result = await this.pool.query<Row>(text, [...values]);
    return result.rows;
  }

  async saveAnalysis(input: { tenantId: string; actorId: string; fingerprint: string; analysis: SafePromptAnalysis; embedding: number[]; expiresAt: Date }): Promise<void> {
    await this.query(`INSERT INTO workload_analyses ("id", "tenantId", "actorId", "fingerprint", "intent", "sanitizedDescriptor", "sensitivityLabels", "freshnessClass", "embedding", "expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10) ON CONFLICT ("tenantId", "fingerprint") DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt"`, [crypto.randomUUID(), input.tenantId, input.actorId, input.fingerprint, input.analysis.intent, input.analysis.descriptor, input.analysis.sensitivityLabels, input.analysis.freshnessClass, `[${input.embedding.join(',')}]`, input.expiresAt]);
  }

  async saveEvaluation(input: { tenantId: string; comparisonId: string; modelId: string; intent: string; evaluation: EvaluationResult }): Promise<void> {
    await this.query(`INSERT INTO evaluation_metrics ("id", "tenantId", "comparisonId", "modelId", "intent", "evaluator", "evaluatorVersion", "scores", "passed") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto.randomUUID(), input.tenantId, input.comparisonId, input.modelId, input.intent, input.evaluation.evaluator, input.evaluation.evaluatorVersion, JSON.stringify(input.evaluation.scores), input.evaluation.passed]);
  }

  async recommendationSignals(tenantId: string, intent: string): Promise<Array<{ modelId: string; qualityScore: number; latencyMsP50?: number; sampleCount: number }>> {
    return this.query(`SELECT "modelId", AVG(("scores"->>'overall')::double precision)::double precision AS "qualityScore", COUNT(*)::int AS "sampleCount" FROM evaluation_metrics WHERE "tenantId"=$1 AND "intent"=$2 GROUP BY "modelId"`, [tenantId, intent]);
  }
}
