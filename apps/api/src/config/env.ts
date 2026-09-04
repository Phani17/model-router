import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DIGITALOCEAN_MODEL_ACCESS_KEY: z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).optional()
  ),
  DIGITALOCEAN_INFERENCE_BASE_URL: z.string().url().default('https://inference.do-ai.run'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  RATE_LIMIT_CAPACITY: z.coerce.number().positive().default(20),
  RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(20 / 60),
  DATABASE_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DATABASE_URL: z.string().url().default('postgresql://model_router:model_router@localhost:5432/model_router?schema=public'),
  CACHE_FINGERPRINT_KEY: z.string().min(32).default('local-development-key-change-me-32chars'),
  AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  OIDC_ISSUER: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  OIDC_AUDIENCE: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  OIDC_JWKS_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  OIDC_TENANT_CLAIM: z.string().min(1).default('tenant_id'),
  OIDC_ROLES_CLAIM: z.string().min(1).default('roles'),
  ROUTER_ALLOWED_MODELS: z.string().default(''),
  ROUTER_DEFAULT_MODEL: z.string().default(''),
  ROUTER_MAX_FALLBACKS: z.coerce.number().int().min(0).max(3).default(2),
  ROUTER_TOTAL_DEADLINE_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  ROUTER_MIN_EVIDENCE_SAMPLES: z.coerce.number().int().min(1).max(1000).default(5)
}).superRefine((value, context) => {
  if (value.AUTH_ENABLED && (!value.OIDC_ISSUER || !value.OIDC_AUDIENCE || !value.OIDC_JWKS_URL)) {
    context.addIssue({ code: 'custom', message: 'OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL are required when AUTH_ENABLED=true' });
  }
});

export function parseEnv(input: NodeJS.ProcessEnv) {
  return schema.parse(input);
}

export const env = parseEnv(process.env);
