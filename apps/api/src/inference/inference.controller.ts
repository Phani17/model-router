import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { InferenceRateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { InferenceService } from '../services/inference-service.js';
import { inferenceRequestSchema, type InferenceRequestDto } from './dto/inference-request.dto.js';
import { GuardrailsGuard } from '../guardrails/guardrails.guard.js';

@Controller('api/v1/inference')
export class InferenceController {
  constructor(@Inject(InferenceService) private readonly service: InferenceService) {}

  @Post('test')
  @HttpCode(200)
  @UseGuards(GuardrailsGuard, InferenceRateLimitGuard)
  invoke(
    @Body(new ZodValidationPipe(inferenceRequestSchema)) body: InferenceRequestDto
  ) {
    return this.service.invoke(body.model, body.prompt, body.temperature, body.maxTokens);
  }
}
