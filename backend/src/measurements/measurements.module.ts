import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MeasurementCatalogService } from './measurement-catalog.service.js';
import {
  MeasurementCatalogController,
  MeasurementsController,
} from './measurements.controller.js';
import { MeasurementsService } from './measurements.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MeasurementCatalogController, MeasurementsController],
  providers: [MeasurementCatalogService, MeasurementsService],
})
export class MeasurementsModule {}
