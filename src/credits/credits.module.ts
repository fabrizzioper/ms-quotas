import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quota } from '../quotas/entities/quota.entity';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';
import { Credit } from './entities/credit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Credit, Quota])],
  controllers: [CreditsController],
  providers: [CreditsService],
})
export class CreditsModule {}
