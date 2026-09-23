import { crc32 } from 'node:zlib';

// Synthetic 2x2 RGBA APNG: red then blue, 100ms per frame. Built from PNG
// signature/IHDR/acTL/fcTL/IDAT/fcTL/fdAT/IEND with zlib-compressed scanlines
// and valid CRCs. No external image or personal data.
export function twoFramePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABFJREFUeJxj+M/A8B+EGWAMAEfKB/lnWW63AAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAAABAAoAAHMnNtQAAAAUZmRBVAAAAAJ4nGNgYPj/H4KhDAA/0gf51gDBTQAAAABJRU5ErkJggg==',
    'base64',
  );
}

export function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
