import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CurriculaService } from './curricula.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [CurriculaService],
  exports: [CurriculaService],
})
export class CurriculaModule {}
