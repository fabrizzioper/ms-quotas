import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn()
  key: string;

  @Column()
  targetId: string;

  @Column()
  operation: string;

  @Column('int')
  responseStatus: number;

  @Column('jsonb')
  responseBody: object;

  @CreateDateColumn()
  createdAt: Date;
}
