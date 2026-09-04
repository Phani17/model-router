import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service.js';
import { FeaturesController } from './features.controller.js';

@Global()
@Module({ controllers: [FeaturesController], providers: [FeatureFlagsService], exports: [FeatureFlagsService] })
export class ConfigModule {}
