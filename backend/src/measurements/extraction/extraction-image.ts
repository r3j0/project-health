import { HttpException } from '@nestjs/common';
import sharp from 'sharp';
import { EXTRACTION_POLICY } from './extraction.config.js';
import { extractionError } from './extraction-error.js';

function imageFormat(buffer: Buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'jpeg';
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

export async function prepareImage(
  file: Pick<Express.Multer.File, 'buffer' | 'mimetype'> | undefined,
) {
  if (!file?.buffer.length) throw extractionError(400, 'IMAGE_REQUIRED');
  if (file.buffer.length > EXTRACTION_POLICY.maxImageBytes)
    throw extractionError(413, 'IMAGE_TOO_LARGE');
  const format = imageFormat(file.buffer);
  if (!format) throw extractionError(415, 'UNSUPPORTED_IMAGE');
  if (file.mimetype !== `image/${format}`)
    throw extractionError(415, 'IMAGE_TYPE_MISMATCH');
  const decoder = sharp(file.buffer, {
    failOn: 'warning',
    limitInputPixels: EXTRACTION_POLICY.maxPixels,
  });
  try {
    const meta = await decoder.metadata();
    if (meta.format !== format)
      throw extractionError(415, 'IMAGE_TYPE_MISMATCH');
    if ((meta.pages ?? 1) !== 1)
      throw extractionError(400, 'MULTI_FRAME_IMAGE');
    if (
      !meta.width ||
      !meta.height ||
      meta.width > EXTRACTION_POLICY.maxDimension ||
      meta.height > EXTRACTION_POLICY.maxDimension ||
      meta.width * meta.height > EXTRACTION_POLICY.maxPixels
    )
      throw extractionError(413, 'IMAGE_DIMENSIONS_EXCEEDED');
    // Full decoding detects truncated/corrupt pixel data. Rotation respects EXIF;
    // re-encoding strips EXIF/GPS/comments and trailing payloads, without resizing.
    const image = await decoder
      .rotate()
      .toColourspace('srgb')
      .png()
      .timeout({ seconds: EXTRACTION_POLICY.decodeTimeoutSeconds })
      .toBuffer();
    if (image.length > EXTRACTION_POLICY.maxImageBytes)
      throw extractionError(413, 'IMAGE_TOO_LARGE');
    return image;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    // libvips can enforce the pixel limit during metadata parsing, before the
    // explicit dimensions check above. Keep both rejection paths consistent.
    if (
      error instanceof Error &&
      error.message === 'Input image exceeds pixel limit'
    )
      throw extractionError(413, 'IMAGE_DIMENSIONS_EXCEEDED');
    throw extractionError(400, 'INVALID_IMAGE');
  } finally {
    decoder.destroy();
  }
}
