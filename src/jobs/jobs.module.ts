import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { OverdueService } from './overdue.service';

@Module({
  controllers: [JobsController],
  providers: [OverdueService],
})
export class JobsModule {}
