import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { RequestIdentity } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { GuardrailsGuard } from '../guardrails/guardrails.guard.js';
import { RouterRateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { routerRequestSchema, type RouterRequestDto } from './dto/router-request.dto.js';
import { RouterService } from './router.service.js';

@Controller('api/v1/router')
export class RouterController {
  constructor(@Inject(RouterService) private readonly router: RouterService) {}

  @Post('execute')
  @HttpCode(200)
  @UseGuards(GuardrailsGuard, RouterRateLimitGuard)
  execute(
    @Body(new ZodValidationPipe(routerRequestSchema)) body: RouterRequestDto,
    @Req() request: FastifyRequest & { identity?: RequestIdentity }
  ) {
    return this.router.execute(body, request.identity);
  }
}

