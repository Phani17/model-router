import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';
import { InferenceClient } from '../clients/inference-client.js';
import { InferenceService } from '../services/inference-service.js';
import { InferenceController } from './inference.controller.js';

@Module({
  imports: [GuardrailsModule],
  controllers: [InferenceController],
  providers: [InferenceClient, InferenceService],
  exports: [InferenceClient, InferenceService]
})
export class InferenceModule {}
