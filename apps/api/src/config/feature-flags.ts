import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).default('false').transform(value => value === 'true');

const featureFlagSchema = z.object({
  FEATURE_TOKEN_COST_GOVERNANCE: booleanFlag,
  FEATURE_EXACT_CACHE: booleanFlag,
  FEATURE_SEMANTIC_CACHE: booleanFlag,
  FEATURE_EVALS: booleanFlag,
  FEATURE_OBSERVABILITY: booleanFlag,
  FEATURE_RECOMMENDATIONS: booleanFlag,
  FEATURE_MODEL_ROUTING: booleanFlag,
  FEATURE_MODEL_FALLBACKS: booleanFlag,
  FEATURE_DEV_IDENTITY: booleanFlag
});

export type FeatureFlags = z.infer<typeof featureFlagSchema>;

export function parseFeatureFlags(input: NodeJS.ProcessEnv): FeatureFlags {
  const flags = featureFlagSchema.parse(input);
  if (flags.FEATURE_SEMANTIC_CACHE && input.DATABASE_ENABLED !== 'true') {
    throw new Error('FEATURE_SEMANTIC_CACHE requires DATABASE_ENABLED=true');
  }
  if (flags.FEATURE_RECOMMENDATIONS && input.FEATURE_EVALS !== 'true') {
    throw new Error('FEATURE_RECOMMENDATIONS requires FEATURE_EVALS=true');
  }
  if (flags.FEATURE_MODEL_FALLBACKS && input.FEATURE_MODEL_ROUTING !== 'true') {
    throw new Error('FEATURE_MODEL_FALLBACKS requires FEATURE_MODEL_ROUTING=true');
  }
  if (flags.FEATURE_DEV_IDENTITY && input.NODE_ENV === 'production') {
    throw new Error('FEATURE_DEV_IDENTITY is prohibited in production');
  }
  return flags;
}

export const featureFlags = parseFeatureFlags(process.env);
