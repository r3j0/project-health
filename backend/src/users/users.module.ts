import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UserProfileModule } from './user-profile.module.js';
import { FitnessGoalsService } from './fitness-goals.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [AuthModule, DatabaseModule, UserProfileModule],
  controllers: [UsersController],
  providers: [FitnessGoalsService],
})
export class UsersModule {}
