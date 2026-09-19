import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { API_V1 } from '../config/api-version.js';

@Controller({ path: 'health', version: API_V1 })
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness() {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'unavailable',
      });
    }
    return { status: 'ok', database: 'ok' };
  }
}
