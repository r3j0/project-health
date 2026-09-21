import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MeasurementCatalogService } from '../measurement-catalog.service.js';
import { extractionError } from './extraction-error.js';
import { prepareImage } from './extraction-image.js';
import { OpenAIExtractionClient } from './openai-extraction.client.js';
import { validateExtraction } from './extraction-validation.js';

const bodySchema = z.strictObject({
  catalogVersion: z.string().trim().min(1).max(100).optional(),
});

@Injectable()
export class ExtractionService {
  constructor(
    @Inject(MeasurementCatalogService)
    private readonly catalogs: MeasurementCatalogService,
    @Inject(OpenAIExtractionClient)
    private readonly openai: OpenAIExtractionClient,
  ) {}

  async extract(
    file: Express.Multer.File | undefined,
    body: unknown,
    signal: AbortSignal,
  ) {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw extractionError(400, 'INVALID_EXTRACTION_INPUT');
    const image = await prepareImage(file);
    try {
      if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
      const catalog = await this.catalogs.get(parsed.data.catalogVersion);
      if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
      return validateExtraction(
        await this.openai.extract(image, catalog, signal),
        catalog,
      );
    } finally {
      image.fill(0);
    }
  }
}
