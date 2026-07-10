import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OverdueCheckResult, OverdueService } from './overdue.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly overdueService: OverdueService) {}

  @Post('run-overdue-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Marca como OVERDUE las cuotas PENDING vencidas y aplica la penalidad única (simula un CRON)',
  })
  run(): Promise<OverdueCheckResult> {
    return this.overdueService.runOverdueCheck();
  }
}
