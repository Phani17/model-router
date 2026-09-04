import { Injectable } from '@nestjs/common';
import type { SafePromptAnalysis } from '../privacy/privacy-analysis.service.js';

export interface ReusePolicy {
  eligible: boolean;
  ttlSeconds: number;
  reason: 'CURRENT' | 'SENSITIVE' | 'STABLE' | 'STANDARD';
}

@Injectable()
export class TtlPolicyService {
  forAnalysis(analysis: SafePromptAnalysis): ReusePolicy {
    if (analysis.sensitivityLabels.length > 0) {
      return { eligible: false, ttlSeconds: 0, reason: 'SENSITIVE' };
    }
    if (analysis.freshnessClass === 'CURRENT') {
      return { eligible: true, ttlSeconds: 5 * 60, reason: 'CURRENT' };
    }
    if (analysis.freshnessClass === 'STABLE') {
      return { eligible: true, ttlSeconds: 30 * 24 * 60 * 60, reason: 'STABLE' };
    }
    return { eligible: true, ttlSeconds: 24 * 60 * 60, reason: 'STANDARD' };
  }
}
