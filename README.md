# Model Router

Model Router is a full-stack proof of concept for comparing several DigitalOcean-hosted language models on one prompt, measuring their behavior, and building privacy-safe signals for future model recommendations. This README is the repository's single documentation source.

## Included capabilities

- Responsive Next.js 16 and React 19 comparison workspace.
- NestJS API running on `@nestjs/platform-fastify`.
- Live DigitalOcean model discovery and inference.
- Concurrent comparison of two to four models.
- Per-model retries, timeouts, deadlines, failure isolation, and token metadata.
- Server-Sent Events for comparison lifecycle progress.
- Weighted rate limiting based on downstream model fan-out.
- Strict input and output guardrails that are always enabled.
- PostgreSQL with pgvector for privacy-safe derived analysis.
- Feature-flagged evaluation, governance, observability, semantic analysis, and recommendations.
- Provider-neutral OIDC/OAuth 2.0 authentication, roles, and tenant isolation.
- Multi-stage production containers, Docker Compose, tests, and GitHub Actions CI.

Provider token-by-token streaming is not included. SSE reports comparison lifecycle events and returns each answer when that model finishes.

## Architecture

```text
Browser
  -> Next.js application
  -> same-origin /api/backend/* proxy
  -> NestJS controllers and guards
  -> comparison and inference services
  -> DigitalOcean Inference

NestJS services
  -> deterministic evaluations and safe metrics
  -> PostgreSQL + pgvector derived signals
  -> tenant-scoped recommendations
```

The browser never receives the DigitalOcean key or backend service address. The Next.js route forwards request and streaming response bodies. Frontend and API share a pnpm monorepo but remain independently deployable: `apps/api` contains NestJS, `apps/web` contains Next.js, and `packages/shared` contains shared TypeScript contracts.

## API

| Method | Route | Purpose | Access |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness | Public |
| `GET` | `/health/ready` | Database readiness | Public |
| `GET` | `/api/v1/features` | Public feature states | Public |
| `GET` | `/api/v1/models` | DigitalOcean model catalog | Public |
| `POST` | `/api/v1/inference/test` | Single-model inference | User |
| `POST` | `/api/v1/comparisons` | Synchronous comparison | User |
| `POST` | `/api/v1/comparisons/stream` | Comparison progress over SSE | User |
| `GET` | `/api/v1/metrics` | Safe aggregate metrics | Evaluator or admin |
| `GET` | `/api/v1/recommendations?intent=CODING` | Tenant rankings | User |

Comparison requests accept a prompt, two to four unique model IDs, optional temperature, and optional maximum output tokens. Zod validation preserves structured HTTP 400 errors. Final results remain in requested model order even though progress events arrive in completion order.

SSE events are `comparison_started`, `model_started`, `model_retrying`, `model_completed`, `model_failed`, and `comparison_completed`. The synchronous endpoint remains the fallback.

## Resilience and rate limiting

Each model executes independently and concurrently. Defaults are three attempts, an eight-second attempt timeout, a twenty-second total deadline, exponential backoff with full jitter, and a two-second maximum backoff. HTTP 408, 429, 5xx, transient network errors, and timeouts are retryable. Permanent client/authentication failures are not. Provider `Retry-After` takes precedence within configured limits.

The local token bucket charges one unit for single inference and one unit per comparison model. Defaults are 20 units capacity and 20 units per minute refill. Invalid requests do not consume quota. Accepted responses expose rate-limit headers; denied requests return HTTP 429 with `Retry-After`.

The PoC limiter is process-local and IP-keyed. Multi-replica production should use distributed, verified-tenant quota and concurrency enforcement.

## Strict safety and privacy

Guardrails are always active and have no feature flag. Requests fail closed before quota consumption or provider invocation when they contain detected credentials, instruction overrides, action/tool execution requests, or invalid model identifiers. Model calls expose no tools or functions. Suspicious output is quarantined and provider failures become safe messages.

Raw prompts and model answers exist only in transient request memory. They must never be written to PostgreSQL, pgvector, logs, traces, metrics, caches, queues, or error payloads.

Persistence is restricted to:

- keyed HMAC fingerprints;
- fixed-category intent, freshness, length, and sensitivity labels;
- descriptors assembled only from that fixed vocabulary;
- embeddings created only from fixed descriptors, never user or model text;
- numeric evaluation scores and pass/fail state;
- aggregate latency, token, reliability, and recommendation signals;
- expiry and verified tenant metadata.

The schema has no prompt, response, or sanitized-answer column. An upgrade migration removes the former response-cache table. Embeddings are sensitive derived data and remain tenant-scoped with TTLs.

Answers are never persisted, so semantic analysis cannot replay a previous answer. It accelerates grouping, evaluation retrieval, and recommendations; later requests still invoke a model. Exact-cache mode deduplicates only identical concurrent in-flight requests and discards the promise after completion.

Sensitive inputs bypass persistence. Current-information descriptors expire after five minutes, standard/unknown descriptors after one day, and stable descriptors after thirty days.

## Evaluation, observability, and recommendations

The deterministic evaluator calculates non-empty, lexical relevance, concision, safety, and overall scores. Only numbers and pass/fail state are returned or stored. A stronger evaluator can replace it without changing the privacy boundary.

Observability records numeric request, success, failure, latency, token, and retry counters. Prompt and answer content are prohibited from metric values and labels.

Recommendations rank models using tenant-scoped aggregate evaluation, latency, cost when known, and sample confidence. No ranking is returned while disabled or when evidence is absent.

## Feature flags

Strict guardrails and privacy enforcement cannot be disabled.

| Capability | Flag | Default | Persistence |
| --- | --- | --- | --- |
| Token/cost governance | `FEATURE_TOKEN_COST_GOVERNANCE` | Off | None |
| Concurrent exact deduplication | `FEATURE_EXACT_CACHE` | Off | Unresolved promises only |
| Derived semantic analysis | `FEATURE_SEMANTIC_CACHE` | Off | Fingerprint, descriptor, vector, TTL |
| Deterministic evaluation | `FEATURE_EVALS` | Off | Numeric scores only |
| Operational metrics | `FEATURE_OBSERVABILITY` | Off | Numeric counters only |
| Recommendations | `FEATURE_RECOMMENDATIONS` | Off | Aggregate signals only |
| Local development identity | `FEATURE_DEV_IDENTITY` | Off | No production use |

Semantic analysis requires the database. Recommendations require evaluations. Development identity is rejected in production. Token/cost governance stays off by default so PoC quality is not silently reduced. When enabled, it caps output and compacts very long inference context while preserving opening and latest constraints; evaluation inputs are not compacted.

## Authentication and tenant isolation

Shared and production environments use provider-neutral OpenID Connect/OAuth 2.0 SSO. Enable `AUTH_ENABLED` and configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL`. The API validates asymmetric signature, allowed algorithm, issuer, audience, expiry, subject, tenant claim, and application roles.

Roles are `USER`, `EVALUATOR`, and `ADMIN`; administrators satisfy all checks. Persistence uses only tenant identity from the verified token. Client-supplied tenant identifiers are never trusted.

For browsers, place the app behind the organization's OIDC identity proxy/BFF. It completes Authorization Code with PKCE, keeps its session in a Secure, HttpOnly, SameSite cookie, and supplies the access token to the same-origin Next.js proxy. The app does not implement local passwords.

Authentication is off in local Compose. `FEATURE_DEV_IDENTITY` provides deterministic local identities outside production only.

## Local development

Requirements: Node.js 24 and pnpm 10.15.0.

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
# Set DIGITALOCEAN_MODEL_ACCESS_KEY in apps/api/.env for provider routes.
pnpm dev
```

Open `http://localhost:3000`; the API listens on `http://localhost:8080`. Health endpoints work without a DigitalOcean key, but model discovery and inference require one.

```bash
pnpm build
pnpm test
```

Tests mock provider traffic, need no credentials, and incur no inference cost.

## Docker Compose

```bash
cp apps/api/.env.example .env
# Set DIGITALOCEAN_MODEL_ACCESS_KEY in .env.
docker compose up --build
docker compose ps
curl http://localhost:8080/health
```

Open `http://localhost:3000`. Stop with `docker compose down`. If ports are occupied:

```bash
PORT=8081 WEB_PORT=3001 docker compose up --build
```

The stack contains `web`, `api`, and pgvector-backed `postgres`. Fresh databases initialize both migrations. For an existing earlier volume, apply `apps/api/prisma/migrations/20260904190000_remove_response_storage/migration.sql` through the deployment migration process.

Both applications run as the unprivileged `node` user with read-only root filesystems and health checks. Secrets are runtime variables and never image layers.

## CI, deployment, and tradeoffs

GitHub Actions installs from the frozen lockfile, builds and tests both apps, validates Compose, and builds both production images. Production should additionally supply encrypted variables, terminate TLS, use an OIDC proxy/BFF, disable proxy buffering for SSE, migrate the database before rollout, and use shared rate limiting for multiple replicas.

NestJS intentionally retains Fastify as its HTTP engine. Nest provides modules, dependency injection, controllers, guards, and testing overrides; Fastify provides efficient request handling and reply-stream access. The SSE controller uses the Fastify reply because native browser `EventSource` cannot POST the required request body.

## Verification

Final verification passed:

- monorepo production build;
- 65 backend tests across provider, service, guardrail, privacy, cache, evaluation, governance, recommendation, observability, and HTTP boundaries;
- 10 frontend tests for catalog loading, selection, SSE parsing, fallback, partial failure, errors, and feature state;
- Compose configuration validation;
- API and web production image builds;
- ZIP integrity and credential-file review.

## Deliberate next-stage extensions

- Provider token-by-token streaming and disconnect cancellation.
- Distributed tenant quota, spend budgets, and authoritative model pricing.
- Repeatable benchmarks, human feedback, leaderboards, and regression alerts.
- Production routing, fallbacks, and controlled model rollouts.
- An organization-specific OIDC proxy/BFF deployment.
