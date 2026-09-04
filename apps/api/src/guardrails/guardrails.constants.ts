export const GUARDRAIL_REJECTION = {
  error: 'GUARDRAIL_REJECTED',
  message: 'The request was rejected by the application safety policy.'
} as const;

export const OUTPUT_QUARANTINED_MESSAGE =
  'The model response was quarantined by the application safety policy.';
