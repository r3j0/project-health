import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { pngChunk, twoFramePng } from '../../../test/fixtures/png.js';
import { prepareImage } from './extraction-image.js';
import { EXTRACTION_POLICY } from './extraction.config.js';

describe('Real image decoding', () => {
  it('rejects a two-frame APNG even when Sharp only decodes its default image', async () => {
    const buffer = twoFramePng();
    await expect(
      prepareImage({ buffer, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ response: { code: 'MULTI_FRAME_IMAGE' } });
  });

  it('does not mistake text or trailing payloads containing acTL for animation', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const buffer = Buffer.concat([
      png.subarray(0, 33),
      pngChunk('tEXt', Buffer.from('Comment\0acTL')),
      png.subarray(33),
      pngChunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])),
    ]);
    const prepared = await prepareImage({ buffer, mimetype: 'image/png' });
    expect(await sharp(prepared).metadata()).toMatchObject({
      format: 'png',
      width: 2,
      height: 2,
    });
    expect(prepared.includes(Buffer.from('acTL'))).toBe(false);
  });

  it.each(['truncated', 'oversize-chunk', 'short-control', 'zero-frames'])(
    'rejects malformed PNG animation headers (%s)',
    async (kind) => {
      let buffer = twoFramePng();
      if (kind === 'truncated') buffer = buffer.subarray(0, 45);
      if (kind === 'oversize-chunk') buffer.writeUInt32BE(0xffffffff, 33);
      if (kind === 'short-control') buffer.writeUInt32BE(3, 33);
      if (kind === 'zero-frames') buffer.writeUInt32BE(0, 41);
      await expect(
        prepareImage({ buffer, mimetype: 'image/png' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_IMAGE' } });
    },
  );

  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes %s and removes metadata and trailing payloads',
    async (format) => {
      const buffer = await sharp({
        create: { width: 12, height: 8, channels: 3, background: 'white' },
      })
        .withExif({ IFD0: { Artist: 'synthetic-private-metadata' } })
        .toFormat(format)
        .toBuffer();
      const prepared = await prepareImage({
        buffer,
        mimetype: `image/${format}`,
      });
      const meta = await sharp(prepared).metadata();
      expect(meta).toMatchObject({ format: 'png', width: 12, height: 8 });
      expect(meta.exif).toBeUndefined();
      expect(prepared.includes(Buffer.from('synthetic-private-metadata'))).toBe(
        false,
      );
    },
  );

  it('rejects a spoofed MIME type, unknown signature, empty or oversize image', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      prepareImage({ buffer: png, mimetype: 'image/jpeg' }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      prepareImage({
        buffer: Buffer.from('<svg>not a PNG</svg>'),
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(prepareImage(undefined)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      prepareImage({
        buffer: Buffer.alloc(EXTRACTION_POLICY.maxImageBytes + 1),
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('rejects truncated pixel data even if its header can be read', async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(
      prepareImage({
        buffer: png.subarray(0, png.length - 20),
        mimetype: 'image/png',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_IMAGE' } });
  });

  it('rejects huge decoded dimensions in a small compressed upload', async () => {
    const buffer = await sharp({
      create: { width: 10_001, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    expect(buffer.length).toBeLessThan(EXTRACTION_POLICY.maxImageBytes);
    await expect(
      prepareImage({ buffer, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('rejects excess total pixels even when both dimensions are below the per-side limit', async () => {
    const buffer = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    expect(buffer.length).toBeLessThan(EXTRACTION_POLICY.maxImageBytes);
    await expect(
      prepareImage({ buffer, mimetype: 'image/png' }),
    ).rejects.toMatchObject({
      status: 413,
      response: { code: 'IMAGE_DIMENSIONS_EXCEEDED' },
    });
  });

  it('rejects an animated/multi-frame WebP', async () => {
    const pixels = Buffer.alloc(2 * 2 * 3 * 2, 255);
    pixels.fill(0, 12);
    const buffer = await sharp(pixels, {
      raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
    })
      .webp({ loop: 0, delay: [100, 200] })
      .toBuffer();
    expect((await sharp(buffer).metadata()).pages).toBe(2);
    await expect(
      prepareImage({ buffer, mimetype: 'image/webp' }),
    ).rejects.toMatchObject({ response: { code: 'MULTI_FRAME_IMAGE' } });
  });
});
