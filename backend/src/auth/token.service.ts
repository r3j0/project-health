import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

const issuer = 'project-health-api';
const audience = 'project-health-web';

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  readonly accessTtl: number;
  readonly refreshTtl: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('AUTH_JWT_SECRET'), 'hex');
    this.accessTtl = config.getOrThrow<number>('AUTH_ACCESS_TTL_SECONDS');
    this.refreshTtl = config.getOrThrow<number>('AUTH_REFRESH_TTL_SECONDS');
  }

  newRefreshToken() {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  isRefreshToken(token: unknown): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
  }

  async issue(userId: string, sessionId: string, expiresAt: Date) {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + this.accessTtl,
      Math.floor(expiresAt.getTime() / 1000),
    );
    return {
      access_token: await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .setJti(randomUUID())
        .sign(this.key),
      token_type: 'Bearer' as const,
      expires_in: exp - now,
    };
  }

  async verify(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer,
        audience,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'sid', 'iat', 'exp', 'jti'],
      });
      return {
        userId: z.uuid().parse(payload.sub),
        sessionId: z.uuid().parse(payload.sid),
      };
    } catch {
      throw new UnauthorizedException('인증 정보가 유효하지 않습니다.');
    }
  }
}
