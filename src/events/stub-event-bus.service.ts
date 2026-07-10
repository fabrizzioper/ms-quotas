import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent, EventBus } from './event-bus.interface';

@Injectable()
export class StubEventBus implements EventBus {
  private readonly logger = new Logger(StubEventBus.name);

  publish(event: DomainEvent): Promise<void> {
    this.logger.log(
      `[stub] event published: ${event.topic} ${JSON.stringify(event.payload)}`,
    );
    return Promise.resolve();
  }
}
