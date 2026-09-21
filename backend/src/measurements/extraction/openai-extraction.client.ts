import { HttpException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { MeasurementCatalogService } from '../measurement-catalog.service.js';
import { ExtractionConfig } from './extraction.config.js';
import { extractionError, withinDeadline } from './extraction-error.js';
import { catalogPrompt, EXTRACTION_INSTRUCTIONS } from './extraction.prompt.js';
import {
  extractionJsonSchema,
  modelExtractionSchema,
} from './extraction.schema.js';

export const OPENAI_FETCH = Symbol('OPENAI_FETCH');
const responseSchema = z.object({
  status: z.string(),
  output: z
    .array(
      z.object({
        type: z.string(),
        status: z.string().optional(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

@Injectable()
export class OpenAIExtractionClient {
  constructor(
    @Inject(ExtractionConfig) private readonly config: ExtractionConfig,
    @Inject(OPENAI_FETCH) private readonly fetcher: typeof fetch,
  ) {}

  async extract(
    image: Buffer,
    catalog: Awaited<ReturnType<MeasurementCatalogService['get']>>,
    requestSignal: AbortSignal,
  ) {
    const options = this.config.get();
    const controller = new AbortController();
    const signal = AbortSignal.any([requestSignal, controller.signal]);
    const timer = setTimeout(
      () => controller.abort(),
      options.upstreamTimeoutMs,
    );
    try {
      signal.throwIfAborted();
      // Native fetch has no SDK retries. Exactly one attempt; redirects are errors.
      const response = await withinDeadline(
        this.fetcher('https://api.openai.com/v1/responses', {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            store: false,
            max_output_tokens: options.maxOutputTokens,
            instructions: EXTRACTION_INSTRUCTIONS,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: catalogPrompt(catalog) },
                  {
                    type: 'input_image',
                    image_url: `data:image/png;base64,${image.toString('base64')}`,
                    detail: options.imageDetail,
                  },
                ],
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'nfa100_extraction',
                strict: true,
                schema: extractionJsonSchema,
              },
            },
          }),
        }),
        signal,
      );
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status))
          throw extractionError(503, 'OPENAI_CONFIGURATION_ERROR');
        if (response.status === 429)
          throw extractionError(503, 'OPENAI_RATE_LIMITED');
        if (response.status >= 500)
          throw extractionError(503, 'OPENAI_UNAVAILABLE');
        throw extractionError(502, 'OPENAI_REQUEST_REJECTED');
      }
      const body = await withinDeadline(
        readBoundedResponse(response, options.maxResponseBytes),
        signal,
      );
      const parsed = responseSchema.safeParse(JSON.parse(body) as unknown);
      if (!parsed.success)
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      const result = parsed.data;
      if (result.status === 'incomplete')
        throw extractionError(502, 'OPENAI_INCOMPLETE');
      if (result.status !== 'completed')
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      const messages =
        result.output?.filter((output) => output.type === 'message') ?? [];
      if (
        messages.some((message) =>
          message.content?.some((part) => part.type === 'refusal'),
        )
      )
        throw extractionError(422, 'OPENAI_REFUSAL');
      if (messages.some((message) => message.status !== 'completed'))
        throw extractionError(502, 'OPENAI_INCOMPLETE');
      const parts = messages.flatMap((message) => message.content ?? []);
      if (
        parts.length !== 1 ||
        parts[0].type !== 'output_text' ||
        !parts[0].text
      )
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      const extraction = modelExtractionSchema.safeParse(
        JSON.parse(parts[0].text) as unknown,
      );
      if (!extraction.success)
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      return extraction.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
      if (error instanceof SyntaxError)
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      throw extractionError(503, 'OPENAI_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

async function readBoundedResponse(response: Response, maxBytes: number) {
  if (!response.body) throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      size += value.byteLength;
      if (size > maxBytes)
        throw extractionError(502, 'OPENAI_INVALID_RESPONSE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
