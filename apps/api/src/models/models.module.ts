import { Module } from '@nestjs/common';
import { InferenceModule } from '../inference/inference.module.js';
import { ModelsController } from './models.controller.js';

@Module({ imports: [InferenceModule], controllers: [ModelsController] })
export class ModelsModule {}
