import { BadRequestException, CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { GUARDRAIL_REJECTION } from './guardrails.constants.js';
import { GuardrailsService } from './guardrails.service.js';

@Injectable()
export class GuardrailsGuard implements CanActivate {
  constructor(@Inject(GuardrailsService) private readonly guardrails: GuardrailsService) {}

  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest<{ body?: unknown }>().body;
    if (!body || typeof body !== 'object') return true;

    const input = body as { prompt?: unknown; model?: unknown; models?: unknown };
    if (typeof input.prompt !== 'string') return true;
    const models = typeof input.model === 'string'
      ? [input.model]
      : Array.isArray(input.models) && input.models.every(model => typeof model === 'string')
        ? input.models
        : [];
    // DTO validation owns structural errors and preserves the public validation contract.
    if (input.prompt.trim() === '' || models.some(model => model.trim() === '')) return true;
    const decision = this.guardrails.inspectInput(input.prompt, models);
    if (!decision.allowed) {
      throw new BadRequestException({ ...GUARDRAIL_REJECTION, reason: decision.reason });
    }
    return true;
  }
}
