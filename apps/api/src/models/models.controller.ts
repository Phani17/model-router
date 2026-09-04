import { Controller, Get, Inject } from '@nestjs/common';
import { InferenceClient } from '../clients/inference-client.js';
import { Public } from '../auth/auth.decorators.js';

@Controller('api/v1/models')
export class ModelsController {
  constructor(@Inject(InferenceClient) private readonly client: InferenceClient) {}

  @Get()
  @Public()
  async listModels() {
    return { models: await this.client.listModels() };
  }
}
