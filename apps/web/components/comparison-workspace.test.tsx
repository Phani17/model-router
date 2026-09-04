import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonWorkspace } from './comparison-workspace';
import { compareWithProgress, getFeatures, getModels } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  getModels: vi.fn(),
  getFeatures: vi.fn(),
  compareWithProgress: vi.fn(),
  ApiError: class ApiError extends Error {}
}));

const catalog = [
  { id: 'model-a', name: 'Model Alpha', ownedBy: 'Provider A' },
  { id: 'model-b', name: 'Model Beta', ownedBy: 'Provider B' },
  { id: 'model-c', name: 'Model Gamma', ownedBy: 'Provider C' }
];

describe('ComparisonWorkspace', () => {
  beforeEach(() => {
    vi.mocked(getModels).mockResolvedValue(catalog);
    vi.mocked(getFeatures).mockResolvedValue({ tokenCostGovernance: false, exactCache: false, semanticCache: false, evals: false, observability: false, recommendations: false });
    vi.mocked(compareWithProgress).mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads the live model catalog and selects up to three defaults', async () => {
    render(<ComparisonWorkspace />);

    expect(await screen.findByText('Model Alpha')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Compare 3 models' })).toBeEnabled();
    expect(screen.getByText('Safety checks always on')).toBeInTheDocument();
    expect(screen.getByText('Content is not stored')).toBeInTheDocument();
  });

  it('requires two selected models before comparison', async () => {
    const user = userEvent.setup();
    render(<ComparisonWorkspace />);
    await screen.findByText('Model Alpha');

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    expect(screen.getByText('Select at least two models.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare 1 models' })).toBeDisabled();
  });

  it('renders streamed success and isolated failure states', async () => {
    vi.mocked(compareWithProgress).mockImplementation(async (_request, onEvent) => {
      onEvent({ type: 'model_started', comparisonId: 'cmp_1', model: 'model-a' });
      onEvent({ type: 'model_completed', comparisonId: 'cmp_1', result: {
        model: 'model-a', status: 'SUCCESS', response: 'A useful answer', latencyMs: 1200,
        inputTokens: 20, outputTokens: 30, attempts: 1, retryCount: 0
      } });
      onEvent({ type: 'model_failed', comparisonId: 'cmp_1', result: {
        model: 'model-b', status: 'FAILED', latencyMs: 900, error: 'Provider busy', attempts: 3, retryCount: 2
      } });
      onEvent({ type: 'comparison_completed', comparison: {
        comparisonId: 'cmp_1', status: 'PARTIAL_FAILURE', results: [
          { model: 'model-a', status: 'SUCCESS', response: 'A useful answer', latencyMs: 1200, inputTokens: 20, outputTokens: 30 },
          { model: 'model-b', status: 'FAILED', latencyMs: 900, error: 'Provider busy', attempts: 3, retryCount: 2 },
          { model: 'model-c', status: 'TIMEOUT', latencyMs: 8000, error: 'Model deadline exceeded', attempts: 3, retryCount: 2 }
        ]
      } });
    });
    const user = userEvent.setup();
    render(<ComparisonWorkspace />);
    await screen.findByText('Model Alpha');

    await user.click(screen.getByRole('button', { name: 'Compare 3 models' }));

    await waitFor(() => expect(screen.getByText('A useful answer')).toBeInTheDocument());
    expect(screen.getByText('Provider busy')).toBeInTheDocument();
    expect(screen.getByText('Model timed out')).toBeInTheDocument();
    expect(screen.getByText('3 results available')).toBeInTheDocument();
  });
});
