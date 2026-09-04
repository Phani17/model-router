import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';
import { InferenceModule } from '../inference/inference.module.js';
import { ComparisonService } from '../services/comparison-service.js';
import { ComparisonController } from './comparison.controller.js';

@Module({
  imports: [GuardrailsModule, InferenceModule],
  controllers: [ComparisonController],
  providers: [ComparisonService]
})
export class ComparisonModule {}
