import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { DomainEvent, EventBus } from './event-bus.interface';

@Injectable()
export class KafkaEventBus implements EventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaEventBus.name);
  private readonly producer: Producer;

  constructor(config: ConfigService) {
    const kafka = new Kafka({
      clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
      brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.producer.send({
        topic: event.topic,
        messages: [{ value: JSON.stringify(event.payload) }],
      });
      this.logger.log(`Published event ${event.topic}`);
    } catch (error) {
      // La publicación de eventos es un efecto colateral: no debe romper la
      // operación de negocio ya confirmada en la base de datos.
      this.logger.error(
        `Failed to publish event ${event.topic}: ${(error as Error).message}`,
      );
    }
  }
}
