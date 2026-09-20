import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AccessTokenGuard, AuthRequestGuard } from './auth.guards.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRateLimitService,
    AccessTokenGuard,
    AuthRequestGuard,
    PasswordService,
    TokenService,
  ],
  exports: [AccessTokenGuard, AuthService],
})
export class AuthModule {}
