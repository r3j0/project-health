import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';

export type AuthenticatedRequest = Request & {
  user: Awaited<ReturnType<AuthService['authenticate']>>;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.authenticate(request.headers.authorization);
    return true;
  }
}

@Injectable()
export class AuthRequestGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'GET') return true;
    const origin = request.headers.origin;
    // A non-simple header blocks cross-site form submissions. Browser origins
    // must also match; clients such as curl may legitimately have no Origin.
    if (
      request.headers['x-csrf-protection'] !== '1' ||
      (origin !== undefined &&
        origin !== this.config.getOrThrow<string>('FRONTEND_ORIGIN'))
    ) {
      throw new ForbiddenException('허용되지 않은 인증 요청입니다.');
    }
    // Express does not trust forwarded headers unless explicitly configured.
    await this.limits.consume(
      `ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
      60,
      60,
    );
    return true;
  }
}
