import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Quota } from '../../quotas/entities/quota.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum CreditStatus {
  ACTIVE = 'ACTIVE',
  FINALIZADO = 'FINALIZADO',
}

@Entity('credits')
export class Credit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column('numeric', {
    precision: 14,
    scale: 2,
    transformer: decimalTransformer,
  })
  amountTotal: number;

  @Column('int')
  numberOfQuotas: number;

  @Column('date')
  startDate: string;

  @Column({ type: 'enum', enum: CreditStatus, default: CreditStatus.ACTIVE })
  status: CreditStatus;

  @OneToMany(() => Quota, (quota) => quota.credit, { cascade: ['insert'] })
  quotas: Quota[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
