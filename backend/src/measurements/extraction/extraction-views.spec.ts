import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EXTRACTION_POLICY } from './extraction.config.js';
import { prepareImageViews } from './extraction-views.js';

describe('Detailed views of the same report', () => {
  it.each([
    [1201, 1603],
    [1603, 1201],
  ])(
    'preserves the full page and every corner of a %ix%i report',
    async (width, height) => {
      const input = await sharp(
        Buffer.from(
          `<svg width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <rect width="50%" height="50%" fill="#ff0000"/>
        <rect x="50%" width="50%" height="50%" fill="#00ff00"/>
        <rect y="50%" width="50%" height="50%" fill="#0000ff"/>
      </svg>`,
        ),
      )
        .png()
        .toBuffer();
      const views = await prepareImageViews(
        input,
        new AbortController().signal,
      );
      expect(views).toHaveLength(5);
      expect(views[0].image).toBe(input);
      const colors = [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ];
      for (const [i, view] of views.slice(1).entries()) {
        const metadata = await sharp(view.image).metadata();
        expect(metadata.width).toBe(Math.ceil(width * 0.6) * 2);
        expect(metadata.height).toBe(Math.ceil(height * 0.6) * 2);
        expect(metadata.exif).toBeUndefined();
        const pixel = await sharp(view.image)
          .extract({
            left: Math.floor(metadata.width! / 2),
            top: Math.floor(metadata.height! / 2),
            width: 1,
            height: 1,
          })
          .removeAlpha()
          .raw()
          .toBuffer();
        expect([...pixel]).toEqual(colors[i]);
      }
    },
  );

  it('bounds detail dimensions for large uploads', async () => {
    const input = await sharp({
      create: { width: 5000, height: 4000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const views = await prepareImageViews(input, new AbortController().signal);
    for (const view of views.slice(1)) {
      const metadata = await sharp(view.image).metadata();
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(
        EXTRACTION_POLICY.detailViewMaxDimension,
      );
    }
  });

  it('keeps small images single and stops on cancellation', async () => {
    const input = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    expect(
      await prepareImageViews(input, new AbortController().signal),
    ).toEqual([{ image: input, label: '원본 전체' }]);
    await expect(
      prepareImageViews(input, AbortSignal.abort()),
    ).rejects.toMatchObject({ response: { code: 'EXTRACTION_TIMEOUT' } });
  });
});
