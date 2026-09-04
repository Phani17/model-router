import type { ModelResult } from '../models/inference.js';
import type { IntentClass } from '../privacy/privacy-analysis.service.js';

export interface RoutingAttempt {
  model: string;
  status: ModelResult['status'];
  latencyMs: number;
  attempts: number;
  retryCount: number;
  error?: string;
}

export interface RouterResponse {
  routingId: string;
  status: 'SUCCESS' | 'FAILED';
  requestedModels: string[];
  selectedModel: string;
  servedByModel?: string;
  fallbackUsed: boolean;
  selection: {
    intent: IntentClass;
    reason: 'EVIDENCE_RANKED' | 'CONFIGURED_DEFAULT' | 'REQUEST_ORDER';
    policyVersion: 'router-v1';
  };
  attempts: RoutingAttempt[];
  result?: ModelResult;
}

