CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "workload_analyses" (
  "id" UUID PRIMARY KEY,
  "tenantId" VARCHAR(128) NOT NULL,
  "actorId" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(128) NOT NULL,
  "intent" VARCHAR(64) NOT NULL,
  "sanitizedDescriptor" VARCHAR(512) NOT NULL,
  "sensitivityLabels" TEXT[] NOT NULL,
  "freshnessClass" VARCHAR(32) NOT NULL,
  "embedding" vector(1536),
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workload_analyses_tenantId_fingerprint_key" UNIQUE ("tenantId", "fingerprint")
);
CREATE INDEX "workload_analyses_tenantId_intent_idx" ON "workload_analyses" ("tenantId", "intent");
CREATE INDEX "workload_analyses_expiresAt_idx" ON "workload_analyses" ("expiresAt");
CREATE INDEX "workload_analyses_embedding_hnsw_idx" ON "workload_analyses" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "evaluation_metrics" (
  "id" UUID PRIMARY KEY,
  "tenantId" VARCHAR(128) NOT NULL,
  "comparisonId" VARCHAR(128) NOT NULL,
  "modelId" VARCHAR(128) NOT NULL,
  "intent" VARCHAR(64) NOT NULL,
  "evaluator" VARCHAR(64) NOT NULL,
  "evaluatorVersion" VARCHAR(32) NOT NULL,
  "scores" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "evaluation_metrics_tenantId_modelId_createdAt_idx" ON "evaluation_metrics" ("tenantId", "modelId", "createdAt");

CREATE TABLE "recommendation_signals" (
  "id" UUID PRIMARY KEY,
  "tenantId" VARCHAR(128) NOT NULL,
  "intent" VARCHAR(64) NOT NULL,
  "modelId" VARCHAR(128) NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL,
  "latencyMsP50" INTEGER,
  "costMicrosP50" BIGINT,
  "sampleCount" INTEGER NOT NULL,
  "computedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recommendation_signals_tenantId_intent_modelId_key" UNIQUE ("tenantId", "intent", "modelId")
);
