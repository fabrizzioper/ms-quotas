import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusDriver } from '../config/env.validation';
import { EVENT_BUS } from './event-bus.interface';
import { KafkaEventBus } from './kafka-event-bus.service';
import { StubEventBus } from './stub-event-bus.service';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.getOrThrow<EventBusDriver>('EVENT_BUS');
        return driver === EventBusDriver.KAFKA
          ? new KafkaEventBus(config)
          : new StubEventBus();
      },
    },
  ],
  exports: [EVENT_BUS],
})
export class EventsModule {}
