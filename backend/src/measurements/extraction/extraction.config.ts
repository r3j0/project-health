import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { extractionError } from './extraction-error.js';

export const EXTRACTION_POLICY = {
  maxImageBytes: 10 * 1024 * 1024,
  maxPixels: 24_000_000,
  maxDimension: 10_000,
  decodeTimeoutSeconds: 8,
  requestTimeoutMs: 75_000,
  upstreamTimeoutMs: 60_000,
  maxOutputTokens: 8_000,
  maxResponseBytes: 256 * 1024,
  maxAttempts: 1,
  // GPT-5.6 preserves native image dimensions with auto; older models use
  // their supported default instead of receiving an unsupported original level.
  imageDetail: 'auto',
  detailViewMinDimension: 512,
  detailViewMinLongEdge: 1200,
  detailViewMaxDimension: 2400,
  detailViewMaxScale: 2,
  maxPreparedImageBytes: 24 * 1024 * 1024,
  perMinute: 5,
  perDay: 30,
  maxConcurrent: 4,
} as const;

const settingsSchema = z.strictObject({
  apiKey: z.string().trim().min(1).max(512).regex(/^\S+$/),
  model: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_.:-]+$/),
});

@Injectable()
export class ExtractionConfig {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  get() {
    const parsed = settingsSchema.safeParse({
      apiKey: this.config.get<unknown>('OPENAI_API_KEY'),
      model: this.config.get<unknown>('OPENAI_OCR_MODEL'),
    });
    // Optional feature: missing/invalid settings must not prevent app startup.
    if (!parsed.success) throw extractionError(503, 'EXTRACTION_UNAVAILABLE');
    return { ...EXTRACTION_POLICY, ...parsed.data };
  }
}
