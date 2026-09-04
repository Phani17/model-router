import { Injectable } from '@nestjs/common';
import { featureFlags, type FeatureFlags } from './feature-flags.js';

@Injectable()
export class FeatureFlagsService {
  readonly values: Readonly<FeatureFlags> = Object.freeze({ ...featureFlags });

  enabled(flag: keyof FeatureFlags): boolean {
    return this.values[flag];
  }

  publicFlags() {
    return {
      tokenCostGovernance: this.values.FEATURE_TOKEN_COST_GOVERNANCE,
      exactCache: this.values.FEATURE_EXACT_CACHE,
      semanticCache: this.values.FEATURE_SEMANTIC_CACHE,
      evals: this.values.FEATURE_EVALS,
      observability: this.values.FEATURE_OBSERVABILITY,
      recommendations: this.values.FEATURE_RECOMMENDATIONS
    };
  }
}
