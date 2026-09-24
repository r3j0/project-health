import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { RefreshCookieService } from '../auth/refresh-cookie.service.js';
import { parseAccountUpdate } from '../auth/auth-input.js';
import { API_V1 } from '../config/api-version.js';
import { parseAccountDelete } from './user-input.js';

@Controller({ path: 'users/me', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class UsersController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
    @Inject(RefreshCookieService)
    private readonly cookies: RefreshCookieService,
  ) {}

  @Patch()
  @HttpCode(204)
  async update(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseAccountUpdate(body);
    await this.limits.consume(`update-account:${request.user.id}`, 5, 900);
    await this.auth.updateAccount(request.user.id, input);
    this.cookies.clear(response);
  }

  @Delete()
  @HttpCode(204)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseAccountDelete(body);
    await this.limits.consume(`delete-account:${request.user.id}`, 5, 900);
    await this.auth.deleteAccount(request.user.id, input.password);
    this.cookies.clear(response);
  }
}
