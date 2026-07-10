export interface QuotaScheduleItem {
  sequence: number;
  amount: number;
  dueDate: string;
}

export interface BuildScheduleInput {
  amountTotal: number;
  numberOfQuotas: number;
  startDate: string;
  intervalDays: number;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Calcula el cronograma en centavos para evitar errores de punto flotante:
 * cada cuota recibe floor(total/n) y la última absorbe el residuo, de modo
 * que la suma de cuotas siempre es exactamente amountTotal.
 */
export function buildQuotaSchedule(
  input: BuildScheduleInput,
): QuotaScheduleItem[] {
  const { amountTotal, numberOfQuotas, startDate, intervalDays } = input;

  const totalCents = Math.round(amountTotal * 100);
  const baseCents = Math.floor(totalCents / numberOfQuotas);
  const remainderCents = totalCents - baseCents * numberOfQuotas;

  return Array.from({ length: numberOfQuotas }, (_, index) => {
    const sequence = index + 1;
    const isLast = sequence === numberOfQuotas;
    const cents = isLast ? baseCents + remainderCents : baseCents;
    return {
      sequence,
      amount: cents / 100,
      dueDate: addDays(startDate, intervalDays * sequence),
    };
  });
}
