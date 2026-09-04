import { describe, expect, it } from 'vitest';
import { parseFeatureFlags } from '../feature-flags.js';

describe('feature flags', () => {
  it('defaults all optional behavior off', () => {
    expect(Object.values(parseFeatureFlags({}))).toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it('enforces semantic-cache dependencies', () => {
    expect(() => parseFeatureFlags({ FEATURE_SEMANTIC_CACHE: 'true' })).toThrow('requires DATABASE_ENABLED');
  });

  it('enforces recommendation dependencies', () => {
    expect(() => parseFeatureFlags({ FEATURE_RECOMMENDATIONS: 'true' })).toThrow('requires FEATURE_EVALS');
  });

  it('never permits development identity in production', () => {
    expect(() => parseFeatureFlags({ FEATURE_DEV_IDENTITY: 'true', NODE_ENV: 'production' })).toThrow(
      'prohibited in production'
    );
  });

  it('requires routing when model fallbacks are enabled', () => {
    expect(() => parseFeatureFlags({ FEATURE_MODEL_FALLBACKS: 'true' })).toThrow(
      'requires FEATURE_MODEL_ROUTING'
    );
  });
});
