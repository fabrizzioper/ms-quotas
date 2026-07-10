export const EVENT_BUS = Symbol('EVENT_BUS');

export interface DomainEvent {
  topic: string;
  payload: Record<string, unknown>;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
}

export const EventTopics = {
  QUOTA_PAID: 'quota.paid',
  CREDIT_COMPLETED: 'credit.completed',
  QUOTA_OVERDUE: 'quota.overdue',
} as const;
