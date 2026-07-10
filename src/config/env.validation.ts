import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum EventBusDriver {
  KAFKA = 'kafka',
  STUB = 'stub',
}

export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  @IsNotEmpty()
  DB_USER: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  DB_SYNCHRONIZE: boolean;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRES_IN: string;

  @IsEnum(EventBusDriver)
  EVENT_BUS: EventBusDriver;

  @IsString()
  @IsNotEmpty()
  KAFKA_BROKERS: string;

  @IsString()
  @IsNotEmpty()
  KAFKA_CLIENT_ID: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  OVERDUE_PENALTY_RATE: number;

  @IsInt()
  @Min(1)
  QUOTA_INTERVAL_DAYS: number;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join(' | ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}
