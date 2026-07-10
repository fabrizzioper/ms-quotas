import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResultDto } from '../common/dto/pagination.dto';
import { Quota } from '../quotas/entities/quota.entity';
import { buildQuotaSchedule } from './domain/quota-schedule';
import { CreateCreditDto } from './dto/create-credit.dto';
import { QueryQuotasDto } from './dto/query-quotas.dto';
import { Credit, CreditStatus } from './entities/credit.entity';

@Injectable()
export class CreditsService {
  constructor(
    @InjectRepository(Credit)
    private readonly creditsRepository: Repository<Credit>,
    @InjectRepository(Quota)
    private readonly quotasRepository: Repository<Quota>,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateCreditDto): Promise<Credit> {
    const schedule = buildQuotaSchedule({
      amountTotal: dto.amountTotal,
      numberOfQuotas: dto.numberOfQuotas,
      startDate: dto.startDate,
      intervalDays: this.config.getOrThrow<number>('QUOTA_INTERVAL_DAYS'),
    });

    const credit = this.creditsRepository.create({
      userId: dto.userId,
      amountTotal: dto.amountTotal,
      numberOfQuotas: dto.numberOfQuotas,
      startDate: dto.startDate,
      status: CreditStatus.ACTIVE,
      quotas: schedule.map((item) => this.quotasRepository.create(item)),
    });

    return this.creditsRepository.save(credit);
  }

  async findQuotasByUser(
    userId: string,
    query: QueryQuotasDto,
  ): Promise<PaginatedResultDto<Quota>> {
    const { page, limit, status } = query;

    const qb = this.quotasRepository
      .createQueryBuilder('quota')
      .innerJoin('quota.credit', 'credit')
      .where('credit.userId = :userId', { userId })
      .orderBy('quota.dueDate', 'ASC')
      .addOrderBy('quota.sequence', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('quota.status = :status', { status });
    }

    const [data, totalItems] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }
}
