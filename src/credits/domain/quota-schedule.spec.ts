import { buildQuotaSchedule } from './quota-schedule';

describe('buildQuotaSchedule', () => {
  it('divide el monto en cuotas iguales cuando la división es exacta', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 900,
      numberOfQuotas: 3,
      startDate: '2026-08-01',
      intervalDays: 30,
    });

    expect(schedule).toHaveLength(3);
    expect(schedule.map((q) => q.amount)).toEqual([300, 300, 300]);
  });

  it('espacia las fechas de vencimiento cada intervalDays desde startDate', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 900,
      numberOfQuotas: 3,
      startDate: '2026-08-01',
      intervalDays: 30,
    });

    expect(schedule.map((q) => q.dueDate)).toEqual([
      '2026-08-31',
      '2026-09-30',
      '2026-10-30',
    ]);
  });

  it('asigna secuencias 1..N', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 500,
      numberOfQuotas: 5,
      startDate: '2026-01-15',
      intervalDays: 30,
    });

    expect(schedule.map((q) => q.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('la última cuota absorbe el residuo cuando la división no es exacta', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 100,
      numberOfQuotas: 3,
      startDate: '2026-08-01',
      intervalDays: 30,
    });

    expect(schedule.map((q) => q.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('la suma de las cuotas siempre es exactamente el monto total (sin errores de flotante)', () => {
    const cases = [
      { amountTotal: 1000.01, numberOfQuotas: 7 },
      { amountTotal: 0.03, numberOfQuotas: 2 },
      { amountTotal: 999.99, numberOfQuotas: 12 },
      { amountTotal: 850.5, numberOfQuotas: 9 },
    ];

    for (const { amountTotal, numberOfQuotas } of cases) {
      const schedule = buildQuotaSchedule({
        amountTotal,
        numberOfQuotas,
        startDate: '2026-08-01',
        intervalDays: 30,
      });
      const sumCents = schedule.reduce(
        (acc, q) => acc + Math.round(q.amount * 100),
        0,
      );
      expect(sumCents).toBe(Math.round(amountTotal * 100));
    }
  });

  it('maneja el caso de una sola cuota', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 450.75,
      numberOfQuotas: 1,
      startDate: '2026-08-01',
      intervalDays: 30,
    });

    expect(schedule).toEqual([
      { sequence: 1, amount: 450.75, dueDate: '2026-08-31' },
    ]);
  });

  it('cruza correctamente los límites de mes y año', () => {
    const schedule = buildQuotaSchedule({
      amountTotal: 200,
      numberOfQuotas: 2,
      startDate: '2026-12-15',
      intervalDays: 30,
    });

    expect(schedule.map((q) => q.dueDate)).toEqual([
      '2027-01-14',
      '2027-02-13',
    ]);
  });
});
