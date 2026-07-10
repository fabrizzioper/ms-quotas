import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In, QueryFailedError } from 'typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { Credit, CreditStatus } from '../credits/entities/credit.entity';
import { EVENT_BUS, EventTopics } from '../events/event-bus.interface';
import type { DomainEvent, EventBus } from '../events/event-bus.interface';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Quota, QuotaStatus } from './entities/quota.entity';

export const PAY_QUOTA_OPERATION = 'quota.pay';

export interface PayQuotaResult {
  quota: {
    id: string;
    creditId: string;
    sequence: number;
    amount: number;
    penaltyAmount: number;
    totalPaid: number;
    status: QuotaStatus;
    paidAt: string;
  };
  credit: {
    id: string;
    status: CreditStatus;
  };
  creditCompleted: boolean;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class QuotasService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async pay(quotaId: string, idempotencyKey?: string): Promise<PayQuotaResult> {
    try {
      const { result, events } = await this.dataSource.transaction((manager) =>
        this.executePayment(manager, quotaId, idempotencyKey),
      );
      // Los eventos se publican después del commit: si la transacción falla,
      // no se anuncia un pago que nunca ocurrió.
      for (const event of events) {
        await this.eventBus.publish(event);
      }
      return result;
    } catch (error) {
      const replayed = await this.replayIfDuplicateKey(
        error,
        quotaId,
        idempotencyKey,
      );
      if (replayed) {
        return replayed;
      }
      throw error;
    }
  }

  private async executePayment(
    manager: EntityManager,
    quotaId: string,
    idempotencyKey?: string,
  ): Promise<{ result: PayQuotaResult; events: DomainEvent[] }> {
    if (idempotencyKey) {
      const stored = await this.findStoredResponse(
        manager,
        idempotencyKey,
        quotaId,
      );
      if (stored) {
        return { result: stored, events: [] };
      }
    }

    const quota = await manager.findOne(Quota, {
      where: { id: quotaId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!quota) {
      throw new NotFoundException(`Quota ${quotaId} not found`);
    }
    if (quota.status === QuotaStatus.PAID) {
      throw new ConflictException(`Quota ${quotaId} is already paid`);
    }

    quota.status = QuotaStatus.PAID;
    quota.paidAt = new Date();
    await manager.save(quota);

    // Lock sobre el crédito para serializar la comprobación de "última cuota"
    // ante pagos concurrentes de cuotas distintas del mismo crédito.
    const credit = await manager.findOne(Credit, {
      where: { id: quota.creditId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!credit) {
      throw new NotFoundException(`Credit ${quota.creditId} not found`);
    }

    const unpaidCount = await manager.count(Quota, {
      where: {
        creditId: credit.id,
        status: In([QuotaStatus.PENDING, QuotaStatus.OVERDUE]),
      },
    });

    const creditCompleted = unpaidCount === 0;
    if (creditCompleted) {
      credit.status = CreditStatus.FINALIZADO;
      await manager.save(credit);
    }

    const result: PayQuotaResult = {
      quota: {
        id: quota.id,
        creditId: quota.creditId,
        sequence: quota.sequence,
        amount: quota.amount,
        penaltyAmount: quota.penaltyAmount,
        totalPaid: Math.round((quota.amount + quota.penaltyAmount) * 100) / 100,
        status: quota.status,
        paidAt: quota.paidAt.toISOString(),
      },
      credit: {
        id: credit.id,
        status: credit.status,
      },
      creditCompleted,
    };

    if (idempotencyKey) {
      await manager.insert(IdempotencyKey, {
        key: idempotencyKey,
        targetId: quotaId,
        operation: PAY_QUOTA_OPERATION,
        responseStatus: 200,
        responseBody: result as unknown as object,
      });
    }

    const events: DomainEvent[] = [
      {
        topic: EventTopics.QUOTA_PAID,
        payload: {
          quotaId: quota.id,
          creditId: credit.id,
          userId: credit.userId,
          amount: quota.amount,
          penaltyAmount: quota.penaltyAmount,
          paidAt: result.quota.paidAt,
        },
      },
    ];
    if (creditCompleted) {
      events.push({
        topic: EventTopics.CREDIT_COMPLETED,
        payload: {
          creditId: credit.id,
          userId: credit.userId,
          amountTotal: credit.amountTotal,
          completedAt: result.quota.paidAt,
        },
      });
    }

    return { result, events };
  }

  private async findStoredResponse(
    manager: EntityManager,
    idempotencyKey: string,
    quotaId: string,
  ): Promise<PayQuotaResult | null> {
    const existing = await manager.findOne(IdempotencyKey, {
      where: { key: idempotencyKey },
    });
    if (!existing) {
      return null;
    }
    if (
      existing.targetId !== quotaId ||
      existing.operation !== PAY_QUOTA_OPERATION
    ) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used for a different operation',
      );
    }
    return existing.responseBody as unknown as PayQuotaResult;
  }

  /**
   * Carrera entre dos requests concurrentes con la misma Idempotency-Key:
   * ambas pasan la lectura inicial, una comitea y la otra falla con violación
   * de unicidad al insertar la key. En ese caso se devuelve la respuesta
   * almacenada por la request ganadora, cumpliendo el contrato idempotente.
   */
  private async replayIfDuplicateKey(
    error: unknown,
    quotaId: string,
    idempotencyKey?: string,
  ): Promise<PayQuotaResult | null> {
    if (!idempotencyKey || !this.isUniqueViolation(error)) {
      return null;
    }
    return this.findStoredResponse(
      this.dataSource.manager,
      idempotencyKey,
      quotaId,
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === PG_UNIQUE_VIOLATION
    );
  }
}
