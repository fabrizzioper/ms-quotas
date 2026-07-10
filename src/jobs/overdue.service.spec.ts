import { ConflictException } from '@nestjs/common';
import { EventTopics } from '../events/event-bus.interface';
import { OverdueService } from './overdue.service';

describe('OverdueService.runOverdueCheck', () => {
  let service: OverdueService;
  let queryRunner: {
    connect: jest.Mock;
    release: jest.Mock;
    query: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };

  const config = {
    getOrThrow: jest.fn().mockReturnValue(0.15),
  };

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    service = new OverdueService(
      dataSource as never,
      eventBus,
      config as never,
    );
  });

  it('marca las cuotas vencidas como OVERDUE, aplica la penalidad y publica eventos', async () => {
    const rows = [
      { id: 'q1', creditId: 'c1', amount: '300.00', penaltyAmount: '45.00' },
      { id: 'q2', creditId: 'c2', amount: '100.00', penaltyAmount: '15.00' },
    ];
    queryRunner.query
      .mockResolvedValueOnce([{ locked: true }]) // pg_try_advisory_lock
      .mockResolvedValueOnce([rows, rows.length]) // UPDATE ... RETURNING
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }]); // unlock

    const result = await service.runOverdueCheck();

    expect(result.processed).toBe(2);
    expect(result.quotas[0]).toEqual({
      id: 'q1',
      creditId: 'c1',
      amount: 300,
      penaltyAmount: 45,
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: EventTopics.QUOTA_OVERDUE }),
    );

    const updateSql = (
      queryRunner.query.mock.calls[1] as [string, unknown[]]
    )[0];
    expect(updateSql).toContain(`status = 'PENDING'`);
    expect(updateSql).toContain('"dueDate" < CURRENT_DATE');
  });

  it('devuelve 409 si el lock ya está tomado (job en ejecución) y no ejecuta el UPDATE', async () => {
    queryRunner.query.mockResolvedValueOnce([{ locked: false }]);

    await expect(service.runOverdueCheck()).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('libera el lock y la conexión aunque el UPDATE falle', async () => {
    queryRunner.query
      .mockResolvedValueOnce([{ locked: true }])
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);

    await expect(service.runOverdueCheck()).rejects.toThrow('db down');

    const lastSql = (
      queryRunner.query.mock.calls.at(-1) as [string, unknown[]]
    )[0];
    expect(lastSql).toContain('pg_advisory_unlock');
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('no publica eventos cuando no hay cuotas vencidas', async () => {
    queryRunner.query
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);

    const result = await service.runOverdueCheck();

    expect(result).toEqual({ processed: 0, quotas: [] });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
