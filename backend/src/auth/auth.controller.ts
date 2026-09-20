import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AccessTokenGuard, AuthRequestGuard } from './auth.guards.js';
import type { AuthenticatedRequest } from './auth.guards.js';
import { parseCredentials } from './auth-input.js';
import { API_V1 } from '../config/api-version.js';

@Controller({ path: 'auth', version: API_V1 })
@UseGuards(AuthRequestGuard)
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const secure = config.getOrThrow<string>('NODE_ENV') === 'production';
    this.cookieName = secure
      ? '__Host-project_health_refresh'
      : 'project_health_refresh';
    this.cookieOptions = {
      httpOnly: true,
      secure,
      sameSite: config.getOrThrow<'lax' | 'none'>('AUTH_COOKIE_SAME_SITE'),
      path: '/',
    };
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCredentials(body, true);
    await this.limits.consume(`register:${input.email}`, 5, 900);
    return this.respond(
      await this.auth.register(input.email, input.password),
      response,
    );
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCredentials(body);
    await this.limits.consume(`login:${input.email}`, 10, 900);
    return this.respond(
      await this.auth.login(input.email, input.password),
      response,
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return this.respond(
        await this.auth.refresh(this.refreshCookie(request)),
        response,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) this.clearCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      this.refreshCookie(request),
      request.headers.authorization,
    );
    this.clearCookie(response);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  private refreshCookie(request: Request) {
    return parseCookie(request.headers.cookie ?? '')[this.cookieName];
  }

  private respond(
    result: Awaited<ReturnType<AuthService['login']>>,
    response: Response,
  ) {
    response.cookie(this.cookieName, result.refreshToken, {
      ...this.cookieOptions,
      expires: result.expiresAt,
    });
    return result.body;
  }

  private clearCookie(response: Response) {
    response.clearCookie(this.cookieName, this.cookieOptions);
  }
}
