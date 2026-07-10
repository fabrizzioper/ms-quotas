import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateCreditDto {
  @ApiProperty({ example: 'user-123' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 900 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amountTotal: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfQuotas: number;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  startDate: string;
}
