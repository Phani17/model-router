import { Global, Module } from '@nestjs/common';
import { PrivacyAnalysisService } from './privacy-analysis.service.js';
import { DescriptorEmbeddingService } from './descriptor-embedding.service.js';

@Global()
@Module({ providers: [PrivacyAnalysisService, DescriptorEmbeddingService], exports: [PrivacyAnalysisService, DescriptorEmbeddingService] })
export class PrivacyModule {}
