import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { env } from '../config/env.js';

export interface FingerprintInput {
  tenantId: string;
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemVersion: string;
  guardrailVersion: string;
}

@Injectable()
export class FingerprintService {
  create(input: FingerprintInput): string {
    const canonical = JSON.stringify({
      tenantId: input.tenantId,
      prompt: input.prompt.normalize('NFKC').trim().replace(/\s+/g, ' '),
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      systemVersion: input.systemVersion,
      guardrailVersion: input.guardrailVersion
    });
    return crypto.createHmac('sha256', env.CACHE_FINGERPRINT_KEY).update(canonical).digest('base64url');
  }
}
