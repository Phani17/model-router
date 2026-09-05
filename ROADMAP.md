# Model Router — Design Rationale & Roadmap

This document complements `README.md`. It answers two questions the README only touches on in passing:

1. **Why did we build the PoC the way we built it**, and what did each major decision trade away?
2. **If this gets traction, what else should we build** to address "Model FOMO" beyond side-by-side comparison — and in what order?

---

## 1. The problem

Customers hosting/consuming many LLMs experience **Model FOMO**: uncertainty that they picked the right model for a given prompt, and no easy way to find out without manually re-running the prompt elsewhere. Left unaddressed, this either stalls adoption ("I don't trust picking one model") or drives silent overspend ("I'll just call three models every time to be safe").

The PoC's thesis: give the user a fast way to *see* the disagreement between models (comparison), and start building the evidence base that eventually lets the system *resolve* the disagreement for them (routing + recommendations), without ever compromising on prompt/response privacy.

---

## 2. What the PoC actually built

| Capability | Where | Addresses FOMO by... |
|---|---|---|
| Concurrent multi-model comparison, streamed live | `apps/api/src/comparison/`, `apps/web/components/comparison-workspace.tsx` | Letting the user *see* the disagreement directly, side by side, in one prompt |
| Deterministic evaluation scoring | `apps/api/src/evals/evaluation.service.ts` | Turning "which answer is better" into a number instead of a guess |
| Policy-based routing + bounded fallback | `apps/api/src/router/` | Removing the decision from the user entirely for repeat/known intents |
| Evidence-based recommendations | `apps/api/src/recommendations/recommendation.service.ts` | Surfacing *why* a model is trusted (sample count, quality/latency/cost) instead of asserting it blindly |
| Safe observability | `apps/api/src/observability/metrics.service.ts` | Giving operators (not just end users) confidence signals, without ever touching prompt content |

These five are stages of the same funnel: **compare → score → recommend → auto-route**, all gated behind feature flags so each stage can be enabled independently and rolled back cheaply.

---

## 3. Design choices and tradeoffs, end to end

### 3.1 Transport: Next.js proxy + NestJS/Fastify, not a direct browser→provider call

**Choice:** The browser never talks to DigitalOcean directly. It calls a same-origin Next.js route (`apps/web/app/api/backend/[...path]/route.ts`), which forwards to a NestJS/Fastify backend, which calls the provider.

**Why:** Keeps the provider API key server-side only; avoids CORS entirely; lets the deployment topology (backend host, provider, auth) change without any frontend code changes.

**Tradeoff:** An extra network hop and two places request bodies get parsed/forwarded. We accepted this because streaming still works end-to-end (the proxy pipes `upstream.body` unbuffered rather than buffering it into a string — `route.ts:50-54`), so the latency cost is a single hop, not a buffering delay.

**Why Fastify under Nest specifically:** Nest gives us modules/DI/guards/testability; Fastify gives raw `reply.raw` access, which the SSE controller needs because `reply.hijack()` (`comparison.controller.ts:32`) is the only way to hand-write SSE frames — Nest's default response pipeline assumes one JSON body per request.

### 3.2 Streaming via hand-rolled SSE, not `EventSource`, with a synchronous fallback

**Choice:** SSE frames are parsed manually (`apps/web/lib/sse.ts`) instead of using the browser's native `EventSource`.

**Why:** `EventSource` can't send a `POST` body or custom headers, and a comparison request needs both (JSON prompt body, `Authorization` header). A synchronous `POST /api/v1/comparisons` fallback exists specifically for environments where streaming is unavailable (`compareWithProgress` in `lib/api.ts:79-89` transparently falls back to it and synthesizes an equivalent event sequence).

**Tradeoff:** More code to maintain (a real parser instead of a browser API) and no automatic reconnection semantics that `EventSource` provides for free. We accepted this because POST+streaming was a hard requirement, not a nice-to-have — token-by-token streaming (see roadmap) will need this investment anyway.

**What we deliberately did *not* build:** provider token-by-token streaming. SSE today reports *comparison lifecycle* events (`model_started`, `model_retrying`, `model_completed`) and returns each full answer only when that model finishes. This was a scope cut for the PoC timeline, not an architectural limitation — it's first on the near-term roadmap below.

### 3.3 Concurrency model: fan-out with per-model isolation, not a shared timeout

**Choice:** Every model in a comparison is invoked concurrently via `Promise.allSettled` (`comparison-service.ts:57-87`), each with its own retry/backoff/timeout state machine (`inference-service.ts`), so one model's failure or slowness never blocks or corrupts another's result.

**Why:** The entire value proposition is "see all models' answers" — if one slow/broken model could stall the others, the feature would be unusable in exactly the failure mode it exists to catch.

**Tradeoff:** Total cost/load scales linearly with the number of models compared (an N-model comparison costs N provider calls), and the rate limiter has to account for that (`ComparisonRateLimitGuard` charges `models.length` tokens, not a flat 1). We accepted this because partial results are strictly better than an all-or-nothing failure for this use case.

### 3.4 Resilience: bounded retries with full-jitter backoff, not infinite retry or best-effort single-shot

**Choice:** Each model gets up to 3 attempts, an 8s per-attempt timeout, a 20s per-model deadline, and full-jitter exponential backoff (`inference-service.ts`, `DEFAULT_POLICY`). The router additionally imposes one *shared* deadline across its whole fallback chain (`ROUTER_TOTAL_DEADLINE_MS`).

**Why:** LLM providers are flaky at the tail (5xx bursts, cold starts) — a single-shot call would surface transient failures to the user unnecessarily, while unbounded retry would let one bad model consume the entire request budget.

**Tradeoff:** Retries increase p99 latency and provider cost for the requests that do need them. We bounded both (attempts and total deadline) so the worst case is predictable, not unbounded.

### 3.5 Privacy: derive-and-discard, never store, by construction

**Choice:** Raw prompts and model responses exist only in transient request memory. Persistence (`apps/api/prisma/schema.prisma`) accepts only: HMAC fingerprints, fixed-vocabulary descriptors (`intent:CODING;freshness:STABLE;...`), embeddings derived *only* from those descriptors (not from raw text), numeric eval scores, and aggregate signals. `PrivacyAnalysisService.assertPersistenceSafe()` is a runtime guard directly in front of every write, independent of the schema itself.

**Why:** This is the single biggest trust risk of a multi-model comparison tool — customers pasting real prompts (which may contain proprietary code, PII, or secrets) into a system that fans them out to third-party providers. We chose to make leakage structurally hard (no column exists to put raw text in, not just "we promise not to log it") rather than relying on policy/discipline alone.

**Tradeoff:** This limits what "smarter caching" can ever do — semantic cache can group and rank similar workloads, but it can never replay a previous literal answer, because the answer was never stored. We accepted this deliberately: a small latency/cost inefficiency (recompute instead of replay) buys a privacy guarantee we consider non-negotiable for this product category. Any future "answer caching" feature would need an explicit, separate opt-in data-retention decision — it is not a natural extension of the current architecture.

### 3.6 Rate limiting: local token bucket, explicitly marked PoC-grade

**Choice:** In-process, IP-keyed token bucket (`services/rate-limiter.ts`), not a distributed limiter.

**Why:** Sufficient for a single-instance PoC and keeps the demo free of an external dependency (Redis, etc.).

**Tradeoff:** Breaks down under horizontal scaling (each replica has its own bucket, so real capacity is `replicas × capacity`, not `capacity`) and IP-keying is a weak proxy for tenant identity behind NAT/shared egress. This is explicitly called out as a "fix before production multi-replica" item, not a hidden gap.

### 3.7 Auth: provider-neutral OIDC, with a dev-identity escape hatch that's poisoned for prod

**Choice:** `AuthGuard` verifies OIDC JWTs against a remote JWKS in real deployments; locally, `FEATURE_DEV_IDENTITY` synthesizes an identity from headers instead. That flag is a **hard startup failure** if `NODE_ENV=production` (`feature-flags.ts`), not just a default-off flag.

**Why:** We wanted local development to not require standing up an IdP, but the failure mode of that convenience leaking to production (unauthenticated `ADMIN` access) was severe enough to make it fail at boot, not just fail a code review.

**Tradeoff:** One more thing that can misconfigure a deployment into refusing to start. We accepted that over the alternative (a silent security hole).

### 3.8 Evaluation: deterministic scoring, not LLM-as-judge

**Choice:** `EvaluationService` scores non-emptiness, lexical relevance (term overlap), concision, and safety with plain regex/heuristics — no model call.

**Why:** Avoids cost, latency, and circularity (using an LLM to judge LLMs introduces its own bias and cost that scales with the very comparisons it's meant to evaluate). It's also privacy-safe by construction — it never needs to send content anywhere.

**Tradeoff:** It's a weak proxy for actual answer quality — lexical overlap isn't semantic correctness, and "safety" here only catches leaked tool-call syntax, not nuanced harm. This is explicitly the piece we expect to replace first as the product matures (see roadmap 4.2) — the interface (`EvaluationResult`) is designed so a stronger evaluator can be swapped in without touching the privacy boundary or any caller.

### 3.9 Routing policy: evidence-first, but with safe cold-start fallback

**Choice:** `RouterService.selectModels()` prefers models ranked by real tenant evidence (`EVIDENCE_RANKED`), falls back to an administrator-configured default (`CONFIGURED_DEFAULT`) if there isn't enough evidence yet, and finally to the caller's own request order (`REQUEST_ORDER`) if neither applies.

**Why:** A pure evidence-based router is useless on day one (no evidence exists yet) and a pure static-default router never improves. The three-tier fallback gives a sane behavior at every point on the evidence-accumulation curve.

**Tradeoff:** Early on, "routing" is mostly just "your configured default with retries" — the real value only shows up after enough comparison/eval traffic accumulates. This is intentional and disclosed in the response (`selection.reason`), not hidden.

---

## 4. Roadmap: other ways to solve Model FOMO

Assume traction: users are running comparisons regularly. The comparison UI is the wedge, not the whole product. The roadmap below is organized by **why each stage exists**, not just what it is, and each builds directly on a service that already exists in the PoC.

### Phase 0 (already built, ships with PoC)
- Live concurrent comparison (`comparison/`)
- Deterministic evals (`evals/`)
- Evidence-based recommendations (`recommendations/`)
- Feature-flagged routing + bounded fallback (`router/`)
- Safe observability (`observability/`)

### Phase 1 — Near-term (0–2 quarters): make the existing wedge feel finished

1. **Token-by-token streaming.** Biggest visible gap vs. user expectation set by ChatGPT-style UIs. Requires switching `InferenceClient.chat()` to a streaming provider call and re-plumbing SSE events to be per-token rather than per-model-completion. *Why now:* it's the single most common piece of feedback a comparison tool gets, and the SSE pipeline already exists — this is an extension, not new infrastructure.
2. **Distributed, tenant-aware rate limiting.** Move `TokenBucketRateLimiter` state to a shared store (e.g. Redis) and key by verified tenant, not IP. *Why now:* this is the PoC's most explicitly disclosed scaling gap; anything after this that increases traffic makes it worse.
3. **Real cost accounting.** Today token/cost governance caps *context size*, not *dollars*. Add authoritative per-provider pricing and a per-tenant spend budget/alerting, surfaced in the comparison UI ("this comparison will cost ~$X across 4 models"). *Why now:* cost anxiety is a first-class driver of Model FOMO — showing the actual price tag directly attacks the anxiety, not just the technical uncertainty.
4. **Stronger evaluator, pluggable.** Swap the deterministic heuristic for an LLM-judge or a hybrid (deterministic pre-filter + LLM judge only when heuristic scores are ambiguous), keeping the privacy boundary and `EvaluationResult` interface unchanged. *Why now:* everything downstream (recommendations, routing) is only as good as this signal, and the interface was designed for exactly this swap.

### Phase 2 — Mid-term (2–4 quarters): move from "help me compare" to "help me decide once"

5. **Persistent per-user/per-team model preferences.** Let a user say "for code review, always prefer model X unless it's down," store that as a first-class preference (not just inferred evidence), and let `RouterService.selectModels()` consult it ahead of evidence ranking. *Why:* evidence-based routing is powerful but impersonal — some teams have policy reasons (compliance, vendor contracts) to pin a model regardless of measured quality.
6. **Leaderboards and repeatable benchmarks.** Turn `EvaluationMetric`/`RecommendationSignal` aggregates into a public-within-org leaderboard per intent category (coding, analysis, creative, factual), with regression alerts when a provider silently changes model behavior. *Why:* this converts one-off comparisons into an ongoing trust signal the org can point to instead of re-litigating "which model" every time.
7. **Human feedback loop.** Add a lightweight thumbs-up/down or preference-pair capture on comparison results, feeding into `RecommendationSignal.qualityScore` as a second evidence source alongside deterministic eval scores. *Why:* deterministic + LLM-judge scoring both have blind spots that real user preference data corrects for.
8. **Multi-provider expansion.** Generalize `InferenceClient` from a single DigitalOcean-shaped adapter to a provider-plugin interface (OpenAI-compatible, Anthropic, Bedrock, etc.), with routing/comparison agnostic to provider. *Why:* Model FOMO isn't scoped to one provider's catalog — the anxiety gets worse, not better, as more providers exist. This is a natural point to do it because the routing/eval/recommendation layers are already provider-agnostic by design (they operate on model IDs and result shapes, not provider specifics).

### Phase 3 — Long-term (4+ quarters): make the system anticipate the decision

9. **Live provider health scoring and controlled rollout.** Track real-time provider health (latency/error trendlines from `MetricsService`, extended to be time-windowed rather than lifetime-cumulative) and use it to influence routing in near-real-time — e.g. temporarily deprioritize a model mid-incident without waiting for a human to update `ROUTER_ALLOWED_MODELS`.
10. **Canary/shadow evaluation of new models.** When a provider ships a new model, automatically shadow-run it against a sample of real (but privacy-scrubbed, per existing rules) traffic, accumulate `RecommendationSignal` evidence for it before ever exposing it as a routing candidate. *Why:* removes "should I even try the new model" from the user entirely — the system already knows by the time it's offered.
11. **Cost/quality tradeoff visualizer, not just a router.** A UI surface (extending the "roadmap strip" already stubbed in the frontend) showing the quality/latency/cost frontier across models for a given intent, letting a user or team set an explicit policy ("cheapest model that clears 0.8 quality for coding") that the router then enforces. *Why:* the endgame for Model FOMO isn't "trust the black box," it's "give me the levers and let me set the policy once."
12. **Organization-specific OIDC proxy/BFF as a packaged deployment artifact**, so enterprise customers can adopt the whole system (auth included) without building their own identity bridge. *Why last:* it's an adoption/distribution unlock, not a capability — it matters most once phases 1–2 have proven the product is worth deploying broadly.

---

## 5. How to read this roadmap

Each phase is additive to the existing feature-flag architecture, not a rewrite: every item above extends a service that already exists (`RouterService`, `RecommendationService`, `EvaluationService`, `MetricsService`, `InferenceClient`) rather than introducing a parallel system. That was itself a deliberate PoC design choice — build the plumbing (guards, DI, feature flags, privacy boundary) once, generously, so that the *product* roadmap becomes mostly a sequence of service-level extensions rather than infrastructure rewrites.
