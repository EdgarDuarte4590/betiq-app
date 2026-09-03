# BetIQ — Cron Jobs Setup

## Arquitectura

Los cron jobs de BetIQ corren **externamente via cron-job.org**, no via Vercel.

**Motivo:** Vercel Free plan limita a 1 cron job por día. BetIQ necesita 3.
**Solución:** cron-job.org llama a los endpoints de la app cada X horas.

---

## Los 3 Jobs

### 1. refresh-odds — Actualizar cuotas
- **URL:** `https://[TU-APP].vercel.app/api/cron/refresh-odds`
- **Schedule:** Cada 6 horas (00:00, 06:00, 12:00, 18:00 UTC)
- **Header:** `Authorization: Bearer [CRON_SECRET]`
- **Qué hace:** Llama a The Odds API, guarda snapshot en `odds_snapshots`
- **Rate limit interno:** Saltea si el último snapshot tiene < 4h

### 2. sync-scores — Sincronizar resultados
- **URL:** `https://[TU-APP].vercel.app/api/cron/sync-scores`
- **Schedule:** Diario a las 08:00 CST (14:00 UTC)
- **Header:** `Authorization: Bearer [CRON_SECRET]`
- **Qué hace:** Actualiza el status (won/lost) de las apuestas pendientes

### 3. send-picks — Enviar picks por Telegram
- **URL:** `https://[TU-APP].vercel.app/api/cron/send-picks`
- **Schedule:** Diario a las 15:00 CST (21:00 UTC)
- **Header:** `Authorization: Bearer [CRON_SECRET]`
- **Qué hace:** Genera los smart picks del día y los envía por Telegram

---

## Configuración en cron-job.org

1. Ir a https://console.cron-job.org
2. Crear cuenta gratuita
3. Para cada job: **Create cronjob**
   - URL: la URL del endpoint
   - Schedule: seleccionar el horario
   - Headers: agregar `Authorization: Bearer [CRON_SECRET]`
   - Enable notifications on failure: ✅

---

## Variables de entorno requeridas

```bash
CRON_SECRET=<valor-secreto>  # Mismo valor en Vercel y en cron-job.org
```

---

## Diagnóstico

### Test de Telegram
```
GET https://[TU-APP].vercel.app/api/admin/test-telegram
Authorization: Bearer [CRON_SECRET]
```

### Test manual de refresh-odds
```
GET https://[TU-APP].vercel.app/api/cron/refresh-odds
Authorization: Bearer [CRON_SECRET]
```

El endpoint retorna si fue ejecutado o si fue saltado por rate limit.
