import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { QuotaStatus } from '../../quotas/entities/quota.entity';

export class QueryQuotasDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QuotaStatus })
  @IsOptional()
  @IsEnum(QuotaStatus)
  status?: QuotaStatus;
}
