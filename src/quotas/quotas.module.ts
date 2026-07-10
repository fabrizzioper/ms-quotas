import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credit } from '../credits/entities/credit.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Quota } from './entities/quota.entity';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quota, Credit, IdempotencyKey])],
  controllers: [QuotasController],
  providers: [QuotasService],
})
export class QuotasModule {}
