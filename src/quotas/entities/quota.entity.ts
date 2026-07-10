import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Credit } from '../../credits/entities/credit.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

export enum QuotaStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

@Entity('quotas')
export class Quota {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  creditId: string;

  @ManyToOne(() => Credit, (credit) => credit.quotas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creditId' })
  credit: Credit;

  @Column('int')
  sequence: number;

  @Column('numeric', {
    precision: 14,
    scale: 2,
    transformer: decimalTransformer,
  })
  amount: number;

  @Column('numeric', {
    precision: 14,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  penaltyAmount: number;

  @Column('date')
  dueDate: string;

  @Index()
  @Column({ type: 'enum', enum: QuotaStatus, default: QuotaStatus.PENDING })
  status: QuotaStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
