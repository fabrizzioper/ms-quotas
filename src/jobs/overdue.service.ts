import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { EVENT_BUS, EventTopics } from '../events/event-bus.interface';
import type { EventBus } from '../events/event-bus.interface';

interface OverdueQuotaRow {
  id: string;
  creditId: string;
  amount: string;
  penaltyAmount: string;
}

export interface OverdueCheckResult {
  processed: number;
  quotas: Array<{
    id: string;
    creditId: string;
    amount: number;
    penaltyAmount: number;
  }>;
}

// Identificador estable del advisory lock, derivado del nombre del job para
// no colisionar con otros locks de la misma base de datos.
const ADVISORY_LOCK_KEY = 'ms-quotas:overdue-check';

@Injectable()
export class OverdueService {
  private readonly logger = new Logger(OverdueService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    private readonly config: ConfigService,
  ) {}

  async runOverdueCheck(): Promise<OverdueCheckResult> {
    const penaltyRate = this.config.getOrThrow<number>('OVERDUE_PENALTY_RATE');

    // El advisory lock vive en la sesión: se necesita la misma conexión para
    // adquirirlo y liberarlo, por eso se usa un QueryRunner dedicado.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      const [{ locked }] = (await queryRunner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [ADVISORY_LOCK_KEY],
      )) as Array<{ locked: boolean }>;
      if (!locked) {
        throw new ConflictException('Overdue check is already running');
      }

      try {
        // Un único UPDATE atómico: solo toca cuotas PENDING vencidas, por lo
        // que la penalidad del 15% se aplica exactamente una vez por cuota.
        const [rows] = (await queryRunner.query(
          `UPDATE quotas
              SET status = 'OVERDUE',
                  "penaltyAmount" = ROUND(amount * $1, 2),
                  "updatedAt" = now()
            WHERE status = 'PENDING'
              AND "dueDate" < CURRENT_DATE
        RETURNING id, "creditId", amount, "penaltyAmount"`,
          [penaltyRate],
        )) as [OverdueQuotaRow[], number];

        const quotas = rows.map((row) => ({
          id: row.id,
          creditId: row.creditId,
          amount: parseFloat(row.amount),
          penaltyAmount: parseFloat(row.penaltyAmount),
        }));

        for (const quota of quotas) {
          await this.eventBus.publish({
            topic: EventTopics.QUOTA_OVERDUE,
            payload: { ...quota, penaltyRate },
          });
        }

        this.logger.log(`Overdue check processed ${quotas.length} quota(s)`);
        return { processed: quotas.length, quotas };
      } finally {
        await queryRunner.query('SELECT pg_advisory_unlock(hashtext($1))', [
          ADVISORY_LOCK_KEY,
        ]);
      }
    } finally {
      await queryRunner.release();
    }
  }
}
