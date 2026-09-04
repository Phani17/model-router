import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';
import { InferenceModule } from '../inference/inference.module.js';
import { RouterController } from './router.controller.js';
import { RouterService } from './router.service.js';

@Module({
  imports: [GuardrailsModule, InferenceModule],
  controllers: [RouterController],
  providers: [RouterService]
})
export class RouterModule {}

