'use client';

import type { ComparisonProgressEvent, ModelInfo, ModelResult } from '@model-router/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, compareWithProgress, getFeatures, getModels, type PublicFeatures } from '@/lib/api';

type CardState = {
  status: 'WAITING' | 'GENERATING' | 'RETRYING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  result?: ModelResult;
  nextAttempt?: number;
  delayMs?: number;
  reason?: string;
};

const examplePrompt = 'Design a distributed rate limiter for a multi-tenant SaaS platform. Explain the tradeoffs.';

function displayName(model: ModelInfo) {
  return model.name && model.name !== model.id ? model.name : model.id;
}

function statusLabel(card: CardState) {
  switch (card.status) {
    case 'WAITING': return 'Waiting';
    case 'GENERATING': return 'Generating';
    case 'RETRYING': return `Retrying · ${card.nextAttempt ?? 2}/3`;
    case 'SUCCESS': return 'Complete';
    case 'TIMEOUT': return 'Timed out';
    case 'FAILED': return 'Failed';
  }
}

function ResultCard({ model, card }: { model: ModelInfo; card: CardState }) {
  const tone = card.status === 'SUCCESS' ? 'success'
    : card.status === 'FAILED' || card.status === 'TIMEOUT' ? 'danger'
      : card.status === 'RETRYING' ? 'warning' : 'neutral';
  const totalTokens = card.result?.inputTokens !== undefined || card.result?.outputTokens !== undefined
    ? (card.result.inputTokens ?? 0) + (card.result.outputTokens ?? 0)
    : undefined;

  return (
    <article className="result-card" aria-labelledby={`model-${model.id}`}>
      <header className="result-header">
        <div className="model-heading">
          <h2 id={`model-${model.id}`}>{displayName(model)}</h2>
          <span>{model.ownedBy ?? 'DigitalOcean model'}</span>
        </div>
        <span className="status" data-tone={tone}><i aria-hidden="true" />{statusLabel(card)}</span>
      </header>

      <div className="result-content">
        {card.status === 'WAITING' && <p className="placeholder-copy">Waiting for the comparison to start.</p>}
        {(card.status === 'GENERATING' || card.status === 'RETRYING') && (
          <div aria-label={statusLabel(card)}>
            <div className="skeleton-line" /><div className="skeleton-line short" /><div className="skeleton-line shorter" />
            {card.status === 'RETRYING' && (
              <p className="retry-copy">{card.reason ?? 'Provider temporarily unavailable'} · retrying in {card.delayMs ?? 0} ms</p>
            )}
          </div>
        )}
        {card.status === 'SUCCESS' && <div className="answer">{card.result?.response || 'The model returned an empty response.'}</div>}
        {(card.status === 'FAILED' || card.status === 'TIMEOUT') && (
          <div className="error-panel">
            <strong>{card.status === 'TIMEOUT' ? 'Model timed out' : 'Model unavailable'}</strong>
            <p>{card.result?.error ?? 'The model could not complete this request.'}</p>
            <small>Other model results remain available.</small>
          </div>
        )}
      </div>

      <footer className="result-meta">
        <span>{card.result ? `${(card.result.latencyMs / 1000).toFixed(1)}s` : '— latency'}</span>
        <span>{totalTokens === undefined ? '— tokens' : `${totalTokens.toLocaleString()} tokens`}</span>
        {card.result?.attempts && card.result.attempts > 1 && <span>{card.result.attempts} attempts</span>}
      </footer>
    </article>
  );
}

export function ComparisonWorkspace() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(examplePrompt);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [runState, setRunState] = useState<'idle' | 'running' | 'complete'>('idle');
  const [notice, setNotice] = useState<string>();
  const [features, setFeatures] = useState<PublicFeatures>();
  const activeRequest = useRef<AbortController | undefined>(undefined);

  const loadModels = useCallback(async () => {
    setCatalogState('loading');
    setNotice(undefined);
    try {
      const [catalog, capabilities] = await Promise.all([getModels(), getFeatures().catch(() => undefined)]);
      setModels(catalog);
      setFeatures(capabilities);
      setSelected(current => current.length > 0 ? current : catalog.slice(0, 3).map(model => model.id));
      setCatalogState('ready');
    } catch {
      setCatalogState('error');
    }
  }, []);

  useEffect(() => {
    void loadModels();
    return () => activeRequest.current?.abort();
  }, [loadModels]);

  const selectedModels = useMemo(
    () => selected.map(id => models.find(model => model.id === id)).filter((model): model is ModelInfo => Boolean(model)),
    [models, selected]
  );
  const canCompare = prompt.trim().length > 0 && selected.length >= 2 && selected.length <= 4 && runState !== 'running';

  const toggleModel = (id: string) => {
    setSelected(current => current.includes(id)
      ? current.filter(modelId => modelId !== id)
      : current.length < 4 ? [...current, id] : current);
  };

  const handleEvent = (event: ComparisonProgressEvent) => {
    if (event.type === 'model_started') {
      setCards(current => ({ ...current, [event.model]: { status: 'GENERATING' } }));
    } else if (event.type === 'model_retrying') {
      setCards(current => ({ ...current, [event.model]: {
        ...current[event.model], status: 'RETRYING', nextAttempt: event.nextAttempt,
        delayMs: event.delayMs, reason: event.reason
      } }));
    } else if (event.type === 'model_completed' || event.type === 'model_failed') {
      setCards(current => ({ ...current, [event.result.model]: {
        status: event.result.status, result: event.result
      } }));
    } else if (event.type === 'comparison_completed') {
      setRunState('complete');
      setCards(Object.fromEntries(event.comparison.results.map(result => [result.model, {
        status: result.status, result
      }])));
    }
  };

  const runComparison = async () => {
    if (!canCompare) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setNotice(undefined);
    setRunState('running');
    setCards(Object.fromEntries(selected.map(id => [id, { status: 'WAITING' }])));
    try {
      await compareWithProgress({ prompt: prompt.trim(), models: selected }, handleEvent, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRunState('idle');
      const retry = error instanceof ApiError && error.retryAfterSeconds
        ? ` Try again in ${error.retryAfterSeconds} seconds.` : '';
      setNotice(`${error instanceof Error ? error.message : 'The comparison could not be completed.'}${retry}`);
    }
  };

  const completeCount = Object.values(cards).filter(card => ['SUCCESS', 'FAILED', 'TIMEOUT'].includes(card.status)).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main"><span aria-hidden="true">M</span>Model Router</a>
        <nav aria-label="Primary"><strong>Compare</strong><span aria-disabled="true">History</span><a href="#roadmap">Roadmap</a></nav>
      </header>

      <main id="main" className="workspace">
        <div className="page-heading"><div><h1>Compare models on your prompt</h1><p>Review answers, latency, and reliability in one place.</p></div><span className="live-badge">DigitalOcean Inference</span></div>

        <section className="trust-strip" aria-label="Safety and privacy controls">
          <div><span className="trust-icon" aria-hidden="true">✓</span><span><strong>Safety checks always on</strong><small>Unsafe action requests are blocked before any model runs.</small></span></div>
          <div><span className="trust-icon" aria-hidden="true">⌁</span><span><strong>Content is not stored</strong><small>Raw prompts and model answers remain outside persistent storage.</small></span></div>
          <div><span className="trust-icon" aria-hidden="true">◇</span><span><strong>{features?.evals ? 'Quality evaluation enabled' : 'Quality controls available'}</strong><small>{features?.tokenCostGovernance ? 'Cost controls are enabled.' : 'Cost controls remain off for full PoC quality.'}</small></span></div>
        </section>

        <section className="composer" aria-labelledby="setup-title">
          <h2 id="setup-title" className="visually-hidden">Comparison setup</h2>
          <label htmlFor="prompt">Prompt</label>
          <textarea id="prompt" value={prompt} maxLength={20_000} onChange={event => setPrompt(event.target.value)} disabled={runState === 'running'} />
          <div className="character-count">{prompt.length.toLocaleString()} / 20,000</div>

          <div className="setup-row">
            <fieldset disabled={catalogState !== 'ready' || runState === 'running'}>
              <legend>Models <span>· {selected.length} selected</span></legend>
              {catalogState === 'loading' && <div className="catalog-message">Loading available models…</div>}
              {catalogState === 'error' && <div className="catalog-message error">Models could not be loaded. <button type="button" onClick={() => void loadModels()}>Retry</button></div>}
              {catalogState === 'ready' && models.length === 0 && <div className="catalog-message">No models are currently available.</div>}
              <div className="model-list">
                {models.map(model => <label className="model-choice" key={model.id} data-selected={selected.includes(model.id)}>
                  <input type="checkbox" checked={selected.includes(model.id)} onChange={() => toggleModel(model.id)} />
                  <span className="check" aria-hidden="true">✓</span><span>{displayName(model)}</span>
                </label>)}
              </div>
              {selected.length < 2 && catalogState === 'ready' && <p className="field-error">Select at least two models.</p>}
              {selected.length === 4 && <p className="selection-hint">Maximum of four models selected.</p>}
            </fieldset>
            <button className="compare-button" type="button" disabled={!canCompare} onClick={() => void runComparison()}>
              {runState === 'running' ? <><span className="spinner" aria-hidden="true" /> Comparing…</> : `Compare ${selected.length || ''} models`}
            </button>
          </div>
        </section>

        {notice && <div className="notice" role="alert"><strong>Comparison unavailable</strong><span>{notice}</span></div>}

        {(selectedModels.length > 0 && (runState !== 'idle' || Object.keys(cards).length > 0)) && <section className="results-section" aria-labelledby="results-title">
          <div className="results-heading"><h2 id="results-title">Comparison</h2><p aria-live="polite">{runState === 'running' ? `${completeCount} of ${selected.length} complete · live` : `${completeCount} results available`}</p></div>
          <div className="result-grid">{selectedModels.map(model => <ResultCard key={model.id} model={model} card={cards[model.id] ?? { status: 'WAITING' }} />)}</div>
        </section>}

        <section id="roadmap" className="roadmap-strip" aria-label="Product direction"><strong>From comparison to confidence</strong><span>Compare</span><i /> <span>Evaluate</span><i /> <span>Recommend</span><i /> <span>Route</span>{features?.recommendations && <b>Recommendations on</b>}</section>
      </main>
    </div>
  );
}
