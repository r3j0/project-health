import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MeasurementCatalogService } from './measurement-catalog.service.js';
import {
  MeasurementCatalogController,
  MeasurementsController,
} from './measurements.controller.js';
import { MeasurementsService } from './measurements.service.js';
import {
  ExtractionController,
  ExtractionGuard,
  ExtractionUploadInterceptor,
} from './extraction/extraction.controller.js';
import { ExtractionConfig } from './extraction/extraction.config.js';
import { ExtractionService } from './extraction/extraction.service.js';
import {
  OPENAI_FETCH,
  OpenAIExtractionClient,
} from './extraction/openai-extraction.client.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    MeasurementCatalogController,
    ExtractionController,
    MeasurementsController,
  ],
  providers: [
    MeasurementCatalogService,
    MeasurementsService,
    ExtractionConfig,
    ExtractionGuard,
    ExtractionUploadInterceptor,
    ExtractionService,
    OpenAIExtractionClient,
    { provide: OPENAI_FETCH, useValue: globalThis.fetch },
  ],
})
export class MeasurementsModule {}
