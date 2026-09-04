import { Injectable } from '@nestjs/common';

export type IntentClass = 'ANALYSIS' | 'CODING' | 'CREATIVE' | 'FACTUAL' | 'GENERAL';
export type FreshnessClass = 'CURRENT' | 'STABLE' | 'UNKNOWN';

export interface SafePromptAnalysis {
  schemaVersion: '1';
  intent: IntentClass;
  freshnessClass: FreshnessClass;
  lengthBucket: 'SHORT' | 'MEDIUM' | 'LONG';
  sensitivityLabels: string[];
  descriptor: string;
}

export interface SafeOutputAnalysis {
  schemaVersion: '1';
  characterCount: number;
  approximateWordCount: number;
  hasCodeBlock: boolean;
  hasCitations: boolean;
}

const INTENT_RULES: Array<[IntentClass, RegExp]> = [
  ['CODING', /\b(code|typescript|javascript|python|api|debug|function|class)\b/i],
  ['ANALYSIS', /\b(analy[sz]e|compare|trade-?offs?|evaluate|reason)\b/i],
  ['CREATIVE', /\b(write|story|poem|brainstorm|creative)\b/i],
  ['FACTUAL', /\b(what|when|where|who|define|explain)\b/i]
];

@Injectable()
export class PrivacyAnalysisService {
  analyzePrompt(prompt: string): SafePromptAnalysis {
    const intent = INTENT_RULES.find(([, pattern]) => pattern.test(prompt))?.[0] ?? 'GENERAL';
    const freshnessClass = /\b(today|current|currently|latest|recent|now|price|weather|news)\b/i.test(prompt)
      ? 'CURRENT'
      : /\b(historical|definition|principle|theorem)\b/i.test(prompt)
        ? 'STABLE'
        : 'UNKNOWN';
    const lengthBucket = prompt.length <= 500 ? 'SHORT' : prompt.length <= 4_000 ? 'MEDIUM' : 'LONG';
    const sensitivityLabels = this.sensitivityLabels(prompt);

    // The descriptor is composed only from a fixed vocabulary. It cannot reconstruct input.
    const descriptor = [
      `intent:${intent}`,
      `freshness:${freshnessClass}`,
      `length:${lengthBucket}`,
      `sensitivity:${sensitivityLabels.join('+') || 'NONE'}`
    ].join(';');

    return {
      schemaVersion: '1',
      intent,
      freshnessClass,
      lengthBucket,
      sensitivityLabels,
      descriptor
    };
  }

  analyzeOutput(output: string): SafeOutputAnalysis {
    return {
      schemaVersion: '1',
      characterCount: output.length,
      approximateWordCount: output.trim() === '' ? 0 : output.trim().split(/\s+/).length,
      hasCodeBlock: output.includes('```'),
      hasCitations: /https?:\/\//i.test(output)
    };
  }

  assertPersistenceSafe(value: unknown): void {
    const serialized = JSON.stringify(value);
    if (serialized.length > 4_096) {
      throw new Error('Derived analysis exceeds the persistence safety boundary.');
    }
    if (/-----BEGIN .*PRIVATE KEY-----|\b(?:sk|dop_v1)_[A-Za-z0-9_-]{20,}/i.test(serialized)) {
      throw new Error('Derived analysis contains prohibited sensitive material.');
    }
  }

  private sensitivityLabels(prompt: string): string[] {
    const labels: string[] = [];
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(prompt)) labels.push('EMAIL');
    if (/\b(?:\+?\d[\d ()-]{8,}\d)\b/.test(prompt)) labels.push('PHONE');
    if (/-----BEGIN .*PRIVATE KEY-----|\b(?:sk|dop_v1)_[A-Za-z0-9_-]{20,}/i.test(prompt)) labels.push('SECRET');
    if (/\b(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]/i.test(prompt)) labels.push('CREDENTIAL');
    return labels.sort();
  }
}
