import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AuthRateLimitService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async consume(subject: string, limit: number, windowSeconds: number) {
    const now = Date.now();
    const window = Math.floor(now / (windowSeconds * 1000));
    const expiresAt = new Date((window + 1) * windowSeconds * 1000);
    // Keyed hashes avoid retaining raw IP addresses and login emails.
    const key = createHmac(
      'sha256',
      this.config.getOrThrow<string>('AUTH_JWT_SECRET'),
    )
      .update(`${subject}:${window}`)
      .digest('hex');
    const row = await this.database.authRateLimit.upsert({
      where: { key },
      create: { key, expiresAt, attempts: 1 },
      update: { attempts: { increment: 1 } },
    });
    if (row.attempts > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retry_after: Math.max(
            1,
            Math.ceil((expiresAt.getTime() - now) / 1000),
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
