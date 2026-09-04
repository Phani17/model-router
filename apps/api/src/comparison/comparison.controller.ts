import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestIdentity } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ComparisonRateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { ComparisonService } from '../services/comparison-service.js';
import { comparisonRequestSchema, type ComparisonRequestDto } from './dto/comparison-request.dto.js';
import { GuardrailsGuard } from '../guardrails/guardrails.guard.js';

@Controller('api/v1/comparisons')
export class ComparisonController {
  constructor(@Inject(ComparisonService) private readonly service: ComparisonService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(GuardrailsGuard, ComparisonRateLimitGuard)
  compare(
    @Body(new ZodValidationPipe(comparisonRequestSchema)) body: ComparisonRequestDto,
    @Req() request: FastifyRequest & { identity?: RequestIdentity }
  ) {
    return this.service.compare(body, request.identity);
  }

  @Post('stream')
  @HttpCode(200)
  @UseGuards(GuardrailsGuard, ComparisonRateLimitGuard)
  async stream(
    @Body(new ZodValidationPipe(comparisonRequestSchema)) body: ComparisonRequestDto,
    @Res() reply: FastifyReply,
    @Req() request: FastifyRequest & { identity?: RequestIdentity }
  ) {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const writeEvent = (event: { type: string }) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };

    await this.service.compareWithProgress(body, writeEvent, request.identity);
    if (!reply.raw.destroyed) reply.raw.end();
  }
}
