import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Credit, CreditStatus } from '../credits/entities/credit.entity';
import { EventTopics } from '../events/event-bus.interface';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Quota, QuotaStatus } from './entities/quota.entity';
import { PAY_QUOTA_OPERATION, QuotasService } from './quotas.service';

describe('QuotasService.pay', () => {
  let service: QuotasService;
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    insert: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };

  const quotaId = 'a3a4b1de-0000-4000-8000-000000000001';
  const creditId = 'b3a4b1de-0000-4000-8000-000000000002';

  const buildQuota = (overrides: Partial<Quota> = {}): Quota =>
    ({
      id: quotaId,
      creditId,
      sequence: 1,
      amount: 300,
      penaltyAmount: 0,
      dueDate: '2026-08-31',
      status: QuotaStatus.PENDING,
      paidAt: null,
      ...overrides,
    }) as Quota;

  const buildCredit = (overrides: Partial<Credit> = {}): Credit =>
    ({
      id: creditId,
      userId: 'user-123',
      amountTotal: 900,
      numberOfQuotas: 3,
      startDate: '2026-08-01',
      status: CreditStatus.ACTIVE,
      ...overrides,
    }) as Credit;

  beforeEach(() => {
    manager = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      count: jest.fn(),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    const dataSource = {
      transaction: jest.fn(
        (cb: (m: typeof manager) => Promise<unknown>): Promise<unknown> =>
          cb(manager),
      ),
      manager,
    };

    service = new QuotasService(dataSource as never, eventBus);
  });

  const mockEntities = (options: {
    idempotencyRecord?: IdempotencyKey | null;
    quota?: Quota | null;
    credit?: Credit | null;
  }) => {
    manager.findOne.mockImplementation((entity: unknown) => {
      if (entity === IdempotencyKey) {
        return Promise.resolve(options.idempotencyRecord ?? null);
      }
      if (entity === Quota) {
        return Promise.resolve(options.quota ?? null);
      }
      if (entity === Credit) {
        return Promise.resolve(options.credit ?? null);
      }
      return Promise.resolve(null);
    });
  };

  it('marca la cuota como PAID y publica quota.paid', async () => {
    mockEntities({ quota: buildQuota(), credit: buildCredit() });
    manager.count.mockResolvedValue(2); // quedan cuotas sin pagar

    const result = await service.pay(quotaId);

    expect(result.quota.status).toBe(QuotaStatus.PAID);
    expect(result.credit.status).toBe(CreditStatus.ACTIVE);
    expect(result.creditCompleted).toBe(false);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: quotaId, status: QuotaStatus.PAID }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: EventTopics.QUOTA_PAID }),
    );
  });

  it('finaliza el crédito y publica credit.completed al pagar la última cuota', async () => {
    mockEntities({ quota: buildQuota(), credit: buildCredit() });
    manager.count.mockResolvedValue(0); // era la última pendiente

    const result = await service.pay(quotaId);

    expect(result.creditCompleted).toBe(true);
    expect(result.credit.status).toBe(CreditStatus.FINALIZADO);
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: EventTopics.CREDIT_COMPLETED }),
    );
  });

  it('una cuota OVERDUE puede pagarse e incluye la penalidad en totalPaid', async () => {
    mockEntities({
      quota: buildQuota({ status: QuotaStatus.OVERDUE, penaltyAmount: 45 }),
      credit: buildCredit(),
    });
    manager.count.mockResolvedValue(1);

    const result = await service.pay(quotaId);

    expect(result.quota.status).toBe(QuotaStatus.PAID);
    expect(result.quota.totalPaid).toBe(345);
  });

  it('rechaza con 409 el pago de una cuota ya pagada', async () => {
    mockEntities({
      quota: buildQuota({ status: QuotaStatus.PAID, paidAt: new Date() }),
    });

    await expect(service.pay(quotaId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('rechaza con 404 una cuota inexistente', async () => {
    mockEntities({ quota: null });

    await expect(service.pay(quotaId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('idempotencia', () => {
    const idempotencyKey = 'retry-key-1';
    const storedResponse = {
      quota: { id: quotaId, status: QuotaStatus.PAID },
      credit: { id: creditId, status: CreditStatus.ACTIVE },
      creditCompleted: false,
    };

    it('guarda la key con la respuesta en el primer intento', async () => {
      mockEntities({
        idempotencyRecord: null,
        quota: buildQuota(),
        credit: buildCredit(),
      });
      manager.count.mockResolvedValue(1);

      await service.pay(quotaId, idempotencyKey);

      expect(manager.insert).toHaveBeenCalledWith(
        IdempotencyKey,
        expect.objectContaining({
          key: idempotencyKey,
          targetId: quotaId,
          operation: PAY_QUOTA_OPERATION,
        }),
      );
    });

    it('un reintento con la misma key devuelve la respuesta almacenada sin repetir el efecto', async () => {
      mockEntities({
        idempotencyRecord: {
          key: idempotencyKey,
          targetId: quotaId,
          operation: PAY_QUOTA_OPERATION,
          responseStatus: 200,
          responseBody: storedResponse,
        } as IdempotencyKey,
      });

      const result = await service.pay(quotaId, idempotencyKey);

      expect(result).toEqual(storedResponse);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('rechaza con 422 una key ya usada para otra cuota', async () => {
      mockEntities({
        idempotencyRecord: {
          key: idempotencyKey,
          targetId: 'otra-cuota',
          operation: PAY_QUOTA_OPERATION,
          responseStatus: 200,
          responseBody: storedResponse,
        } as IdempotencyKey,
      });

      await expect(service.pay(quotaId, idempotencyKey)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('ante una carrera (violación de unicidad) devuelve la respuesta de la request ganadora', async () => {
      const duplicateError = new QueryFailedError(
        'INSERT INTO idempotency_keys',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      let insertAttempted = false;
      manager.findOne.mockImplementation((entity: unknown) => {
        if (entity === IdempotencyKey) {
          // Antes del insert la key no existe; tras la carrera, sí.
          return Promise.resolve(
            insertAttempted
              ? ({
                  key: idempotencyKey,
                  targetId: quotaId,
                  operation: PAY_QUOTA_OPERATION,
                  responseStatus: 200,
                  responseBody: storedResponse,
                } as IdempotencyKey)
              : null,
          );
        }
        if (entity === Quota) return Promise.resolve(buildQuota());
        if (entity === Credit) return Promise.resolve(buildCredit());
        return Promise.resolve(null);
      });
      manager.count.mockResolvedValue(1);
      manager.insert.mockImplementation(() => {
        insertAttempted = true;
        return Promise.reject(duplicateError);
      });

      const result = await service.pay(quotaId, idempotencyKey);

      expect(result).toEqual(storedResponse);
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
