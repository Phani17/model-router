import { Injectable } from '@nestjs/common';

export type GuardrailReason =
  | 'ACTION_REQUEST'
  | 'INSTRUCTION_OVERRIDE'
  | 'MODEL_NOT_ALLOWED'
  | 'SENSITIVE_DATA'
  | 'TOOL_PAYLOAD';

export interface GuardrailDecision {
  allowed: boolean;
  reason?: GuardrailReason;
}

const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk|dop_v1)_[A-Za-z0-9_-]{20,}\b/,
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/
];

const OVERRIDE_PATTERNS = [
  /\bignore (?:all |any )?(?:previous|prior|system|developer) instructions?\b/i,
  /\breveal (?:the )?(?:system|developer) (?:prompt|message|instructions?)\b/i,
  /\b(?:bypass|disable|override) (?:the )?(?:guardrails?|safety|policy|filters?)\b/i,
  /\bdo anything now\b/i
];

const ACTION_PATTERNS = [
  /\b(?:execute|run) (?:this |the )?(?:shell|terminal|bash|command|code)\b/i,
  /\b(?:delete|drop|truncate) (?:the )?(?:database|table|files?|directory)\b/i,
  /\b(?:send|post|publish) (?:an? |the )?(?:email|message|request|tweet)\b/i,
  /\b(?:transfer|withdraw|purchase|buy) (?:money|funds?|shares?|crypto|bitcoin)\b/i,
  /\bcall (?:this |the )?(?:tool|function|api|endpoint)\b/i
];

const TOOL_OUTPUT_PATTERNS = [
  /["'](?:tool_call|function_call|tool_calls)["']\s*:/i,
  /<\/?(?:tool_call|function_call)>/i,
  /\b(?:execute_shell|run_command|delete_file)\s*\(/i
];

@Injectable()
export class GuardrailsService {
  inspectInput(prompt: string, models: string[]): GuardrailDecision {
    if (SENSITIVE_PATTERNS.some(pattern => pattern.test(prompt))) {
      return { allowed: false, reason: 'SENSITIVE_DATA' };
    }
    if (OVERRIDE_PATTERNS.some(pattern => pattern.test(prompt))) {
      return { allowed: false, reason: 'INSTRUCTION_OVERRIDE' };
    }
    if (ACTION_PATTERNS.some(pattern => pattern.test(prompt))) {
      return { allowed: false, reason: 'ACTION_REQUEST' };
    }
    if (models.some(model => !this.isSafeModelId(model))) {
      return { allowed: false, reason: 'MODEL_NOT_ALLOWED' };
    }
    return { allowed: true };
  }

  inspectOutput(output: string): GuardrailDecision {
    if (SENSITIVE_PATTERNS.some(pattern => pattern.test(output))) {
      return { allowed: false, reason: 'SENSITIVE_DATA' };
    }
    if (TOOL_OUTPUT_PATTERNS.some(pattern => pattern.test(output))) {
      return { allowed: false, reason: 'TOOL_PAYLOAD' };
    }
    return { allowed: true };
  }

  safeProviderError(error: unknown): string {
    if (error instanceof Error && /timed? ?out|abort/i.test(error.message)) {
      return 'The model request timed out.';
    }
    return 'The model provider could not complete the request.';
  }

  private isSafeModelId(model: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model);
  }
}
