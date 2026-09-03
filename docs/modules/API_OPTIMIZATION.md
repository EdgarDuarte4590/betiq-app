# Módulo: `api-optimization` — Eliminar Consumo Duplicado de API

## Objetivo
El Dashboard actualmente llama a The Odds API en CADA page load (cada vez que alguien
abre /dashboard). Esto triplica el consumo de requests. La solución es que el Dashboard
lea los datos desde la tabla `odds_snapshots` de Supabase (que ya tiene datos frescos
del cron de cada 6h), en lugar de llamar directamente a la API externa.

## Contexto requerido
Leer `docs/BETIQ_V3_CONTEXT.md` completo antes de empezar.

## Análisis del problema

### Flujo actual (MALO)
```
Usuario abre /dashboard
  → Server Component ejecuta
  → getUpcomingMatches('upcoming') [llama a The Odds API — consume 8-13 requests]
  → saveOddsSnapshot(events)        [escribe en Supabase]
  → getSmartPicks(events)           [algoritmo local]
  → enrichPicksWithStats(picks)     [llama a SofaScore]
  → Renderiza el dashboard
```
**Problema:** Cada page load consume 8-13 requests de Odds API. Con 10 visitas/día = 80-130 requests desperdiciadas.

### Flujo objetivo (CORRECTO)
```
[Cada 6h — via cron-job.org]
  → /api/cron/refresh-odds
  → getUpcomingMatches() [consume 8-13 requests, SOLO aquí]
  → saveOddsSnapshot()

[Usuario abre /dashboard]
  → Server Component ejecuta
  → getDashboardData()   [lee desde odds_snapshots en Supabase — 0 requests API]
  → getSmartPicks(events) [algoritmo local]
  → enrichPicksWithStats(picks)
  → Renderiza el dashboard
```

## Tareas

### T1.1 — Crear lib/data/dashboard-data.ts
- **Archivo nuevo:** `lib/data/dashboard-data.ts`
- Función `getDashboardData(): Promise<OddEvent[]>`
- Lee desde tabla `odds_snapshots` el snapshot más reciente (últimas 7h)
- Reconstruye la estructura `OddEvent[]` que espera el algoritmo
- Usa `unstable_cache` de Next.js con revalidate de 1800s (30 min)
- Si no hay snapshots recientes (>7h), retorna array vacío y loguea warning

```typescript
// Signature esperada
export async function getDashboardData(): Promise<OddEvent[]>
```

### T1.2 — Modificar app/dashboard/page.tsx
- **Cambio:** Reemplazar `getUpcomingMatches('upcoming')` con `getDashboardData()`
- **Eliminar:** La llamada a `saveOddsSnapshot(allEvents)` del dashboard (líneas 46-50)
  — los snapshots SOLO se guardan desde el cron
- El resto del algoritmo permanece igual (getSmartPicks, enrichPicksWithStats, etc.)

### T1.3 — Agregar rate limiting más agresivo al cron refresh-odds
- **Archivo:** `app/api/cron/refresh-odds/route.ts`
- No refrescar si el último snapshot tiene menos de 4h (actualmente el intervalo es 5h en saveOddsSnapshot, pero la verificación debe estar también en el cron)
- Log del resultado: cuántos eventos se actualizaron, qué sports, cuántas requests se usaron

### T1.4 — Eliminar crons de vercel.json (si no lo hizo M0)
- **Archivo:** `vercel.json`
- Eliminar sección `"crons": [...]`

### T1.5 — Crear docs/cron-setup.md
- Documentar las URLs exactas de cron-job.org
- Schedules: refresh-odds (cada 6h), sync-scores (8am CST), send-picks (15:00 CST)
- Cómo configurar el header `Authorization: Bearer CRON_SECRET`
- Instrucciones para agregar nuevo cron job

### T1.6 — Verificar consumo en producción
- Revisar `api_key_usage` en Supabase antes y después del cambio
- Las requests deben bajar dramáticamente (solo las del cron, no las del dashboard)

## Estimación de ahorro
- Antes: ~80-130 requests/día por visitas al dashboard
- Después: ~8-13 requests/día (solo el cron de 6h × 4 veces/día = máximo 52 requests/día)
- **Ahorro: ~60-80% del consumo actual**

## Verificación
```bash
npm run build
npm run lint
```
- [ ] Abrir /dashboard 10 veces seguidas → `api_key_usage.requests_used` no sube
- [ ] Los datos del dashboard son coherentes (partidos y picks aparecen)
- [ ] El cron /api/cron/refresh-odds funciona y sí actualiza `api_key_usage`
- [ ] Log de `/api/cron/refresh-odds` muestra el número de eventos actualizados
