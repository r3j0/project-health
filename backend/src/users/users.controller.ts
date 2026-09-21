import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
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
import { API_V1, API_V1_BASE_PATH } from '../config/api-version.js';
import { UserProfileService } from './user-profile.service.js';
import { FitnessGoalsService } from './fitness-goals.service.js';
import {
  parseUserPatch,
  parseAccountDelete,
  parseGoalCreate,
  parseGoalPatch,
  parseGoalId,
} from './user-input.js';

@Controller({ path: 'users/me', version: API_V1 })
@UseGuards(AccessTokenGuard)
export class UsersController {
  constructor(
    @Inject(UserProfileService) private readonly profiles: UserProfileService,
    @Inject(FitnessGoalsService) private readonly goals: FitnessGoalsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
    @Inject(RefreshCookieService)
    private readonly cookies: RefreshCookieService,
  ) {}

  @Patch()
  patch(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.profiles.patch(request.user.id, parseUserPatch(body));
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(AuthRequestGuard)
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

  @Get('fitness-goals')
  listGoals(@Req() request: AuthenticatedRequest) {
    return this.goals.list(request.user.id);
  }

  @Get('fitness-goals/:id')
  getGoal(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.goals.get(request.user.id, parseGoalId(id));
  }

  @Post('fitness-goals')
  async createGoal(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const goal = await this.goals.create(
      request.user.id,
      parseGoalCreate(body),
    );
    response.setHeader(
      'Location',
      `${API_V1_BASE_PATH}/users/me/fitness-goals/${goal.id}`,
    );
    return goal;
  }

  @Patch('fitness-goals/:id')
  patchGoal(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.goals.patch(
      request.user.id,
      parseGoalId(id),
      parseGoalPatch(body),
    );
  }

  @Delete('fitness-goals/:id')
  @HttpCode(204)
  deleteGoal(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.goals.delete(request.user.id, parseGoalId(id));
  }
}
