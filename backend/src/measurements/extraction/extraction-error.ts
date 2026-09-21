import { HttpException } from '@nestjs/common';

export function extractionError(status: number, code: string): HttpException {
  // Never attach upstream errors, request bodies, image data or credentials.
  return new HttpException({ statusCode: status, code, message: code }, status);
}

export async function withinDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // The operation may already have started before its signal was checked.
    void work.catch(() => {});
    throw extractionError(504, 'EXTRACTION_TIMEOUT');
  }
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(extractionError(504, 'EXTRACTION_TIMEOUT'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
