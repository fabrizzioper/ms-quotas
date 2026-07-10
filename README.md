# ms-quotas — Microservicio de Cuotas

Microservicio en **NestJS + TypeScript** que administra el cronograma de cuotas de un crédito: creación del cronograma, pago idempotente, job de mora con penalidad y consulta paginada, todo protegido con JWT y publicando eventos de dominio a **Kafka**.

## Levantar el proyecto

Requisitos: **Docker con Compose v2** (para el flujo de prueba con curl también se usa [`jq`](https://jqlang.github.io/jq/), opcional).

```bash
cp .env.example .env   # ajusta valores si lo deseas
docker compose up --build
```

Eso levanta **API + PostgreSQL + Kafka (KRaft)** en un solo comando. La API queda en `http://localhost:3000` y la documentación Swagger en `http://localhost:3000/docs`.

> El puerto del Postgres del contenedor se expone en el host según `DB_PORT` del `.env` (por defecto `5433`, para no chocar con un Postgres local en `5432`). Dentro de la red de compose la API conecta a `postgres:5432`.

### Desarrollo local (sin Docker)

```bash
npm install
# apunta DB_HOST/DB_PORT de tu .env a un Postgres accesible
# si no tienes Kafka local: EVENT_BUS=stub
npm run start:dev
```

### Tests

```bash
npm test
```

## Flujo de prueba rápido (curl)

```bash
# 1. Token (cualquier userId)
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"userId":"user-123"}' | jq -r .accessToken)

# 2. Crear crédito con cronograma
curl -s -X POST localhost:3000/credits -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","amountTotal":900,"numberOfQuotas":3,"startDate":"2026-08-01"}'

# 3. Pagar una cuota (idempotente)
curl -s -X POST localhost:3000/quotas/<quotaId>/pay \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: intento-1'

# 4. Job de mora
curl -s -X POST localhost:3000/jobs/run-overdue-check -H "Authorization: Bearer $TOKEN"

# 5. Consulta con filtros y paginación
curl -s "localhost:3000/credits/user-123/quotas?status=PENDING&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Decisiones de diseño

### ¿Por qué PostgreSQL?

- **Idempotencia con garantías reales**: la `Idempotency-Key` se persiste en una tabla con *primary key* única; ante dos requests concurrentes con la misma clave, el constraint de unicidad decide un único ganador y el perdedor devuelve la respuesta almacenada. En MongoDB esto exige transacciones sobre replica set y es menos directo.
- **Transiciones de estado atómicas**: pagar la cuota y finalizar el crédito ocurren en **una transacción** con locks pesimistas (`SELECT … FOR UPDATE`), eliminando carreras entre pagos concurrentes del mismo crédito.
- **El dominio es relacional**: un crédito tiene N cuotas con integridad referencial y agregaciones (conteo de pendientes) triviales en SQL.
- Bonus: los **advisory locks** de Postgres resuelven el lock del job de mora sin infraestructura extra (Redis, etc.).

### Arquitectura

Módulos por *feature* (bounded context), cada uno con sus DTOs, entidades, servicio y controlador:

```
src/
├── auth/       login JWT + JwtAuthGuard global + decorador @Public
├── credits/    creación de crédito + consulta de cuotas
│   └── domain/quota-schedule.ts   ← cálculo del cronograma (función pura, testeable)
├── quotas/     pago idempotente + entidad IdempotencyKey
├── jobs/       job de mora con advisory lock
├── events/     EventBus (interfaz) + KafkaEventBus / StubEventBus
├── health/     endpoint público de salud
├── common/     exception filter global, DTOs de paginación, transformers
└── config/     validación estricta de variables de entorno
```

- **Nada hardcodeado**: toda la configuración (DB, JWT, Kafka, tasa de penalidad, intervalo de días) viene de variables de entorno **validadas al arrancar** (`config/env.validation.ts`); si falta una variable la app no inicia.
- **Manejo de errores centralizado**: `AllExceptionsFilter` global devuelve siempre `{ statusCode, error, message, path, timestamp }`.
- **Validación de entrada** con `class-validator` + `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`).

### Cálculo del cronograma

`buildQuotaSchedule` trabaja **en centavos** para evitar errores de punto flotante: cada cuota recibe `floor(total/n)` y la última absorbe el residuo, de modo que la suma de cuotas es siempre exactamente `amountTotal`. Los vencimientos se espacian cada `QUOTA_INTERVAL_DAYS` (30) días a partir de `startDate` (la cuota 1 vence a los 30 días).

### Idempotencia del pago (`POST /quotas/:id/pay`)

1. Si llega `Idempotency-Key`, dentro de la transacción se busca la clave: si existe y corresponde a la misma cuota, se devuelve **la respuesta almacenada** sin repetir el efecto; si corresponde a otra operación → `422`.
2. Si no existe, se ejecuta el pago (lock pesimista sobre la cuota y luego sobre el crédito) y se inserta la clave con la respuesta **en la misma transacción**.
3. **Carrera** (dos requests simultáneas con la misma clave): ambas pasan la lectura inicial, una comitea y la otra falla con violación de unicidad (`23505`); ese error se captura y se devuelve la respuesta de la ganadora. El contrato idempotente se cumple incluso bajo concurrencia.

Transiciones de estado: `PENDING|OVERDUE → PAID` (una cuota en mora puede pagarse, incluyendo su penalidad); `PAID → PAID` es rechazado con `409`. Si era la última cuota sin pagar, el crédito pasa a `FINALIZADO` en la misma transacción.

### Job de mora (`POST /jobs/run-overdue-check`)

- Un **único `UPDATE` atómico** marca `OVERDUE` y aplica la penalidad del 15% (`OVERDUE_PENALTY_RATE`) **solo** a cuotas `PENDING` vencidas — por construcción la penalidad se aplica exactamente una vez por cuota, aunque el job corra muchas veces.
- **Lock (bonus)**: `pg_try_advisory_lock` impide dos ejecuciones concurrentes del job; la segunda recibe `409` inmediatamente. El lock se libera en `finally` incluso si el UPDATE falla.
- La penalidad se guarda en `penaltyAmount` (no muta `amount`) para conservar trazabilidad del monto original.

### Eventos (bonus Kafka real)

El dominio publica a través de la interfaz `EventBus` (token `EVENT_BUS`), con dos implementaciones intercambiables por env (`EVENT_BUS=kafka|stub`):

- `KafkaEventBus` (kafkajs) publica `quota.paid`, `credit.completed` y `quota.overdue` al broker del compose.
- `StubEventBus` loguea el evento (útil en desarrollo/tests).

Los eventos se publican **después del commit** de la transacción: nunca se anuncia un pago que fue revertido. Un fallo de publicación no rompe la operación de negocio (se loguea); en producción esto evolucionaría a un patrón *outbox*.

### Autenticación

Todos los endpoints están protegidos por un `JwtAuthGuard` **global** (`APP_GUARD`); las excepciones (`/health`, `/auth/login`) se marcan con el decorador `@Public()`. `POST /auth/login` firma un JWT para cualquier `userId` (sin sistema de usuarios real, según el alcance).

### Alcance asumido

- `DB_SYNCHRONIZE=true` (TypeORM crea el esquema) para simplificar la prueba; en producción serían migraciones versionadas.
- El monto de una cuota en mora se paga completo (cuota + penalidad); no hay pagos parciales.
- `GET /credits/:userId/quotas` ordena por fecha de vencimiento y expone `meta` de paginación (`page`, `limit`, `totalItems`, `totalPages`).

## Tests

20 tests unitarios centrados en la lógica de negocio:

- `quota-schedule.spec.ts` — división exacta e inexacta, residuo en la última cuota, suma siempre igual al total, fechas cada 30 días cruzando mes/año.
- `quotas.service.spec.ts` — pago feliz, última cuota → crédito `FINALIZADO`, pago de cuota `OVERDUE` con penalidad, `409` si ya está pagada, `404` si no existe, y los tres escenarios de idempotencia (primer intento, reintento, carrera con violación de unicidad).
- `overdue.service.spec.ts` — penalidad única sobre `PENDING` vencidas, `409` si el lock está tomado, liberación del lock ante fallos, cero eventos si no hay vencidas.
