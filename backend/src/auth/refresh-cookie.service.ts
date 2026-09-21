import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';

@Injectable()
export class RefreshCookieService {
  private readonly name: string;
  private readonly options: CookieOptions;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const secure = config.getOrThrow<string>('NODE_ENV') === 'production';
    this.name = secure
      ? '__Host-project_health_refresh'
      : 'project_health_refresh';
    this.options = {
      httpOnly: true,
      secure,
      sameSite: config.getOrThrow<'lax' | 'none'>('AUTH_COOKIE_SAME_SITE'),
      path: '/',
    };
  }

  read(request: Request) {
    return parseCookie(request.headers.cookie ?? '')[this.name];
  }
  set(response: Response, token: string, expires: Date) {
    response.cookie(this.name, token, { ...this.options, expires });
  }
  clear(response: Response) {
    response.clearCookie(this.name, this.options);
  }
}
