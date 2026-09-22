import sharp from 'sharp';
import { EXTRACTION_POLICY } from './extraction.config.js';
import { extractionError } from './extraction-error.js';

export type ExtractionImageView = { image: Buffer; label: string };

// The overview preserves session/legend context. Overlapping crops make small
// printed numbers legible without generative reconstruction or value selection.
export async function prepareImageViews(image: Buffer, signal: AbortSignal) {
  const views: ExtractionImageView[] = [{ image, label: '원본 전체' }];
  try {
    if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
    const { width, height } = await sharp(image).metadata();
    if (!width || !height) throw extractionError(400, 'INVALID_IMAGE');
    if (
      Math.min(width, height) < EXTRACTION_POLICY.detailViewMinDimension ||
      Math.max(width, height) < EXTRACTION_POLICY.detailViewMinLongEdge
    )
      return views;

    // 20% overlap across the centre keeps nearby labels/units with their values.
    const cropWidth = Math.ceil(width * 0.6);
    const cropHeight = Math.ceil(height * 0.6);
    const scale = Math.min(
      EXTRACTION_POLICY.detailViewMaxScale,
      EXTRACTION_POLICY.detailViewMaxDimension /
        Math.max(cropWidth, cropHeight),
    );
    let totalBytes = image.length;
    for (const [top, vertical] of [
      [0, '상단'],
      [height - cropHeight, '하단'],
    ] as const) {
      for (const [left, horizontal] of [
        [0, '왼쪽'],
        [width - cropWidth, '오른쪽'],
      ] as const) {
        if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
        const decoder = sharp(image);
        try {
          const detail = await decoder
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .resize({
              width: Math.max(1, Math.floor(cropWidth * scale)),
              height: Math.max(1, Math.floor(cropHeight * scale)),
              fit: 'fill',
            })
            .png()
            .timeout({ seconds: EXTRACTION_POLICY.decodeTimeoutSeconds })
            .toBuffer();
          views.push({
            image: detail,
            label: `${vertical} ${horizontal} 상세`,
          });
          totalBytes += detail.length;
          if (totalBytes > EXTRACTION_POLICY.maxPreparedImageBytes)
            throw extractionError(413, 'IMAGE_TOO_LARGE');
        } finally {
          decoder.destroy();
        }
      }
    }
    if (signal.aborted) throw extractionError(504, 'EXTRACTION_TIMEOUT');
    return views;
  } catch (error) {
    for (const view of views.slice(1)) view.image.fill(0);
    if (error instanceof HttpException) throw error;
    throw extractionError(400, 'INVALID_IMAGE');
  }
}
import { HttpException } from '@nestjs/common';
