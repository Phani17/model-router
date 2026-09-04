import { describe, expect, it } from 'vitest';
import { EvaluationService } from '../evaluation.service.js';

describe('EvaluationService', () => {
  const service = new EvaluationService();

  it('scores a relevant safe answer without returning source text', () => {
    const prompt = 'Compare PostgreSQL indexing strategies';
    const response = 'PostgreSQL B-tree indexing supports equality and range queries.';
    const result = service.evaluate(prompt, response);
    expect(result.passed).toBe(true);
    expect(result.scores.relevance).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('PostgreSQL');
  });

  it('fails empty and action-shaped outputs', () => {
    expect(service.evaluate('Explain indexing', '').passed).toBe(false);
    expect(service.evaluate('Explain indexing', '{"tool_call":"delete_file"}').passed).toBe(false);
  });
});
