import { Inject, Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../config/feature-flags.service.js';

export interface GovernedRequest {
  prompt: string;
  maxTokens: number;
  estimatedInputTokens: number;
  compacted: boolean;
}

@Injectable()
export class TokenGovernanceService {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  apply(prompt: string, maxTokens: number, purpose: 'INFERENCE' | 'EVALUATION' = 'INFERENCE'): GovernedRequest {
    const estimatedInputTokens = this.estimate(prompt);
    if (!this.flags.enabled('FEATURE_TOKEN_COST_GOVERNANCE') || purpose === 'EVALUATION') {
      return { prompt, maxTokens, estimatedInputTokens, compacted: false };
    }

    const governedMaxTokens = Math.min(maxTokens, 2_048);
    if (estimatedInputTokens <= 3_000) {
      return { prompt, maxTokens: governedMaxTokens, estimatedInputTokens, compacted: false };
    }

    // Preserve the task opening and latest constraints. Raw text remains transient.
    const compacted = `${prompt.slice(0, 6_000)}\n\n[earlier context compacted]\n\n${prompt.slice(-6_000)}`;
    return {
      prompt: compacted,
      maxTokens: governedMaxTokens,
      estimatedInputTokens: this.estimate(compacted),
      compacted: true
    };
  }

  estimate(value: string): number {
    return Math.max(1, Math.ceil(value.length / 4));
  }
}
