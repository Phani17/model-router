import { Module } from '@nestjs/common';
import { GuardrailsGuard } from './guardrails.guard.js';
import { GuardrailsService } from './guardrails.service.js';

@Module({
  providers: [GuardrailsService, GuardrailsGuard],
  exports: [GuardrailsService, GuardrailsGuard]
})
export class GuardrailsModule {}
