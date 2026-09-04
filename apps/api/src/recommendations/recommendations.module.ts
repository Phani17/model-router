import { Global, Module } from '@nestjs/common';
import { RecommendationService } from './recommendation.service.js';
import { RecommendationsController } from './recommendations.controller.js';

@Global()
@Module({ controllers: [RecommendationsController], providers: [RecommendationService], exports: [RecommendationService] })
export class RecommendationsModule {}
