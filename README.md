# ms-quotas

Microservicio de cuotas de crédito — **NestJS + PostgreSQL + Kafka**.

## Cómo levantarlo (paso a paso)

Único requisito: **Docker** (con Compose v2, viene incluido en Docker Desktop).

**Paso 1 — Clonar el repositorio**

```bash
git clone https://github.com/fabrizzioper/ms-quotas.git
cd ms-quotas
```

**Paso 2 — Crear el archivo `.env`** (obligatorio, sin esto no arranca)

```bash
cp .env.example .env
```

No hace falta editar nada: los valores por defecto funcionan tal cual.

**Paso 3 — Levantar todo**

```bash
docker compose up --build
```

La primera vez tarda unos minutos (descarga imágenes y compila). Está listo cuando veas en los logs:

```
api-1  | ... Kafka producer connected
api-1  | ... Nest application successfully started
```

**Paso 4 — Verificar que funciona**

Abre http://localhost:3717/health — debe responder `{"status":"ok","database":"up",...}`.

| Qué | Dónde |
|---|---|
| API | http://localhost:3717 |
| Swagger | http://localhost:3717/docs |
| Postman | `postman/ms-quotas.postman_collection.json` |

> ¿Algo falla? → [Troubleshooting](#troubleshooting)

## Probarlo en 2 minutos

```bash
# 1. Token
TOKEN=$(curl -s -X POST localhost:3717/auth/login -H 'Content-Type: application/json' \
  -d '{"userId":"user-123"}' | jq -r .accessToken)

# 2. Crear crédito (900 en 3 cuotas)
curl -s -X POST localhost:3717/credits -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","amountTotal":900,"numberOfQuotas":3,"startDate":"2026-08-01"}'

# 3. Pagar una cuota (usa un id de las cuotas del paso 2)
curl -s -X POST localhost:3717/quotas/<quotaId>/pay \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: intento-1'
# repite este mismo curl: devuelve lo mismo, NO cobra dos veces

# 4. Job de mora
curl -s -X POST localhost:3717/jobs/run-overdue-check -H "Authorization: Bearer $TOKEN"

# 5. Listar cuotas
curl -s "localhost:3717/credits/user-123/quotas?status=PENDING&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

Más fácil aún: importa la colección de Postman — el login guarda el token solo.

## Endpoints

| Método | Ruta | Qué hace | Auth |
|---|---|---|---|
| POST | `/auth/login` | JWT de prueba para cualquier `userId` | No |
| POST | `/credits` | Crea crédito + cronograma de cuotas (cada 30 días) | Sí |
| POST | `/quotas/:id/pay` | Paga una cuota (idempotente con `Idempotency-Key`) | Sí |
| POST | `/jobs/run-overdue-check` | Vencidas → `OVERDUE` + penalidad 15% (simula CRON) | Sí |
| GET | `/credits/:userId/quotas` | Lista cuotas, filtro `?status=` + paginación | Sí |
| GET | `/health` | Salud del servicio | No |

## Decisiones de diseño (resumen)

**¿Por qué PostgreSQL?**
- La idempotencia se garantiza con un **unique constraint** sobre la `Idempotency-Key`.
- Pago + finalizar crédito = **una transacción** con locks (`FOR UPDATE`). Sin carreras.
- Crédito → cuotas es relacional puro.

**Idempotencia del pago**
- Misma key → devuelve la respuesta guardada, no repite el cobro.
- Dos requests a la vez con la misma key → el constraint elige un ganador, el otro recibe la misma respuesta.
- Key usada en otra cuota → `422`. Cuota ya pagada → `409`.

**Estados**
- Cuota: `PENDING → PAID`, `PENDING → OVERDUE → PAID`.
- Crédito: `ACTIVE → FINALIZADO` al pagar la última cuota.

**Job de mora**
- Un solo `UPDATE` atómico sobre cuotas `PENDING` vencidas → la penalidad del 15% se aplica **una sola vez**, aunque el job corra mil veces.
- **Advisory lock** de Postgres: dos jobs a la vez es imposible (el segundo recibe `409`).

**Eventos (Kafka real en el compose)**
- Publica `quota.paid`, `credit.completed`, `quota.overdue` **después del commit**.
- Detrás de una interfaz `EventBus` → se cambia a stub con `EVENT_BUS=stub` (sin tocar código).

**Cálculo de cuotas**
- En **centavos** (sin errores de decimales). La última cuota absorbe el residuo: 100 / 3 = `33.33 + 33.33 + 33.34`.

**Config**
- Nada hardcodeado: todo sale del `.env` y se **valida al arrancar** (falta una variable → no inicia).
- Errores siempre con el mismo formato: `{ statusCode, error, message, path, timestamp }`.

## Estructura

```
src/
├── auth/      login + guard JWT global (@Public para excepciones)
├── credits/   crear crédito + listar cuotas (domain/quota-schedule.ts = cálculo puro)
├── quotas/    pago idempotente
├── jobs/      job de mora + lock
├── events/    EventBus → Kafka o stub
├── health/    health check
├── common/    exception filter, paginación
└── config/    validación del .env
```

## Tests

```bash
npm install && npm test   # 20 tests
```

Cubren lo importante: cálculo del cronograma, idempotencia (incluida la carrera concurrente), transiciones de estado y el lock del job.

## Troubleshooting

| Problema | Solución |
|---|---|
| `bind: address already in use` | Cambia `PORT` / `DB_PORT` / `KAFKA_EXTERNAL_PORT` en `.env` |
| API no arranca: `password authentication failed` | Volumen viejo con otra contraseña → `docker compose down -v` y volver a levantar |
| Sin Docker (dev local) | Postgres propio en `.env` + `EVENT_BUS=stub` + `npm run start:dev` |

## Notas de alcance

- `DB_SYNCHRONIZE=true` para simplificar la prueba (en producción: migraciones).
- Cuota en mora se paga completa (monto + penalidad); no hay pagos parciales.
- Puertos por defecto poco comunes (3717/5477/9377) para no chocar con servicios locales.
