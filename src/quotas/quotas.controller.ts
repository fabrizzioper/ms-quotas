import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PayQuotaResult, QuotasService } from './quotas.service';

@ApiTags('quotas')
@ApiBearerAuth()
@Controller('quotas')
export class QuotasController {
  constructor(private readonly quotasService: QuotasService) {}

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Paga una cuota (idempotente vía header Idempotency-Key)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clave única por intento de pago; reintentos con la misma clave devuelven el mismo resultado sin duplicar el efecto',
  })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PayQuotaResult> {
    return this.quotasService.pay(id, idempotencyKey);
  }
}
