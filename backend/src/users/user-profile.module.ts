import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { UserProfileService } from './user-profile.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}
