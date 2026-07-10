import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginatedResultDto } from '../common/dto/pagination.dto';
import { Quota } from '../quotas/entities/quota.entity';
import { CreditsService } from './credits.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { QueryQuotasDto } from './dto/query-quotas.dto';
import { Credit } from './entities/credit.entity';

@ApiTags('credits')
@ApiBearerAuth()
@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Post()
  @ApiOperation({ summary: 'Crea un crédito con su cronograma de cuotas' })
  create(@Body() dto: CreateCreditDto): Promise<Credit> {
    return this.creditsService.create(dto);
  }

  @Get(':userId/quotas')
  @ApiOperation({
    summary:
      'Lista las cuotas de un usuario con filtro por status y paginación',
  })
  findQuotas(
    @Param('userId') userId: string,
    @Query() query: QueryQuotasDto,
  ): Promise<PaginatedResultDto<Quota>> {
    return this.creditsService.findQuotasByUser(userId, query);
  }
}
