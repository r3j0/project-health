import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelResult } from '../../../test/fixtures/extraction.js';
import { AccessTokenGuard } from '../../auth/auth.guards.js';
import { configureApp } from '../../setup-app.js';
import { MeasurementCatalogService } from '../measurement-catalog.service.js';
import { ExtractionConfig, EXTRACTION_POLICY } from './extraction.config.js';
import {
  ExtractionController,
  ExtractionGuard,
  ExtractionUploadInterceptor,
} from './extraction.controller.js';
import { ExtractionService } from './extraction.service.js';
import * as imageViews from './extraction-views.js';
import { OpenAIExtractionClient } from './openai-extraction.client.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Extraction HTTP deadlines and work lifetime', () => {
  let app: INestApplication;
  let url: string;
  let png: Buffer;
  let timeoutMs: number;
  let maxConcurrent: number;
  const buffers: Buffer[] = [];
  const preparations: Array<{ image: Buffer; signal: AbortSignal }> = [];
  const delayed: Array<ReturnType<typeof deferred> & { output: Buffer }> = [];
  const openai = { extract: vi.fn(() => Promise.resolve(modelResult())) };

  beforeEach(async () => {
    timeoutMs = 2_000;
    maxConcurrent = EXTRACTION_POLICY.maxConcurrent;
    buffers.length = 0;
    preparations.length = 0;
    delayed.length = 0;
    openai.extract.mockClear();
    png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({
      controllers: [ExtractionController],
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            TRUST_PROXY_CIDRS: [],
            FRONTEND_ORIGIN: 'http://localhost:3000',
          }),
        },
        ExtractionUploadInterceptor,
        ExtractionService,
        {
          provide: ExtractionConfig,
          useValue: {
            get: () => ({
              ...EXTRACTION_POLICY,
              requestTimeoutMs: timeoutMs,
              maxConcurrent,
            }),
          },
        },
        {
          provide: MeasurementCatalogService,
          useValue: {
            get: () =>
              Promise.resolve({
                version: 'test-catalog',
                checkedOn: '2026-09-19',
                age: null,
                definitions: [],
              }),
          },
        },
        { provide: OpenAIExtractionClient, useValue: openai },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ExtractionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/v1/measurements/extract`;

    const service = app.get(ExtractionService);
    const extract = service.extract.bind(service);
    vi.spyOn(service, 'extract').mockImplementation((file, body, signal) => {
      if (file) buffers.push(file.buffer);
      return extract(file, body, signal);
    });
    const prepareViews = imageViews.prepareImageViews;
    vi.spyOn(imageViews, 'prepareImageViews').mockImplementation(
      (image, signal) => {
        preparations.push({ image, signal });
        return prepareViews(image, signal);
      },
    );
  });

  afterEach(async () => {
    for (const work of delayed) work.resolve();
    await app?.close();
    vi.restoreAllMocks();
  });

  function holdCrops() {
    const extract = sharp.prototype.extract;
    let count = 0;
    vi.spyOn(sharp.prototype, 'extract').mockImplementation(function (
      this: Sharp,
      region,
    ) {
      const decoder = extract.call(this, region);
      if (count++ >= EXTRACTION_POLICY.maxConcurrent) return decoder;
      const gate = deferred();
      const convert = decoder.toBuffer.bind(decoder);
      // Keep the real Sharp promise pending at the service boundary without
      // depending on native thread timing or a resource-intensive test image.
      vi.spyOn(decoder, 'toBuffer').mockImplementation((async () => {
        const output = await convert();
        delayed.push({ ...gate, output });
        await gate.promise;
        return output;
      }) as typeof decoder.toBuffer);
      return decoder;
    });
  }

  function startUpload(complete = true) {
    const boundary = 'extraction-lifetime-test';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      ...(complete ? [Buffer.from(`\r\n--${boundary}--\r\n`)] : []),
    ]);
    const client = httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    const result = new Promise<number | Error>((resolve) => {
      client.on('response', (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
      });
      client.on('error', resolve);
    });
    if (complete) client.end(body);
    else client.write(body);
    return { client, result };
  }

  function upload() {
    return request(url).post('').attach('image', png, 'synthetic.png');
  }

  it.each(['disconnect', 'timeout'])(
    'retains all four slots and buffers after %s until held crops settle',
    async (cancel) => {
      holdCrops();
      const uploads = Array.from(
        { length: EXTRACTION_POLICY.maxConcurrent },
        () => startUpload(),
      );
      await vi.waitFor(() => expect(delayed).toHaveLength(4));
      if (cancel === 'disconnect')
        for (const { client } of uploads) client.destroy();
      const statuses = await Promise.all(uploads.map(({ result }) => result));
      if (cancel === 'timeout') expect(statuses).toEqual([504, 504, 504, 504]);
      await vi.waitFor(() => {
        expect(preparations.every(({ signal }) => signal.aborted)).toBe(true);
      });
      expect(buffers).toHaveLength(4);
      expect(buffers.every((buffer) => buffer.equals(png))).toBe(true);
      expect(preparations.every(({ image }) => image.some(Boolean))).toBe(true);
      expect(openai.extract).not.toHaveBeenCalled();
      for (let i = 0; i < 2; i++) {
        const busy = await upload().expect(503);
        expect(busy.body).toMatchObject({ code: 'EXTRACTION_BUSY' });
      }

      // Exercise both late fulfillment and late rejection after the HTTP result.
      for (const [i, work] of delayed.entries()) {
        if (i % 2 === 0) work.resolve();
        else work.reject(new Error('synthetic conversion failure'));
      }
      await vi.waitFor(() => {
        expect(
          buffers.every((buffer) => buffer.every((byte) => byte === 0)),
        ).toBe(true);
        expect(
          preparations.every(({ image }) => image.every((byte) => byte === 0)),
        ).toBe(true);
      });
      expect(openai.extract).not.toHaveBeenCalled();
      // Successful transforms handed their output to prepareImageViews, which
      // wipes it on abort. Rejected transforms never hand their output over.
      expect(delayed[0].output.every((byte) => byte === 0)).toBe(true);
      expect(delayed[2].output.every((byte) => byte === 0)).toBe(true);
      await upload().expect(200);
      expect(openai.extract).toHaveBeenCalledTimes(1);
    },
  );

  it('returns 504 for an unfinished upload and releases its slot after Multer cleanup', async () => {
    timeoutMs = 100;
    maxConcurrent = 1;
    const { client, result } = startUpload(false);
    try {
      expect(await result).toBe(504);
      expect(openai.extract).not.toHaveBeenCalled();
      expect(buffers).toHaveLength(0);
      timeoutMs = 2_000;
      await upload().expect(200);
    } finally {
      client.destroy();
    }
  });

  it('releases a slot after image validation rejects the upload', async () => {
    maxConcurrent = 1;
    await request(url)
      .post('')
      .attach('image', Buffer.from('invalid'), 'synthetic.png')
      .expect(415);
    expect(buffers[0].every((byte) => byte === 0)).toBe(true);
    await upload().expect(200);
  });
});
