import { Controller, Get, Inject } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service.js';
import { Public } from '../auth/auth.decorators.js';

@Controller('api/v1/features')
export class FeaturesController {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  @Get()
  @Public()
  list() {
    return this.flags.publicFlags();
  }
}
