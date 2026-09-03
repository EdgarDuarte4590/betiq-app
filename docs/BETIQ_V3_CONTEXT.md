# BetIQ v3.0 — Contexto Maestro para Agentes

> **Este archivo es el punto de entrada para cualquier agente o conversación nueva.**
> Leerlo completo antes de tocar cualquier código.
> Actualizar cuando cambien decisiones arquitectónicas.

---

## Qué es BetIQ

App de análisis de apuestas deportivas en producción. Analiza cuotas de múltiples bookmakers
usando algoritmos estadísticos (vig removal, Kelly Criterion, consensus de sharp books) para
identificar **value bets** — apuestas donde las cuotas del mercado infravaloran la probabilidad
real de un resultado.

**Stack:** Next.js 16 · React 19 · TypeScript · Supabase · TailwindCSS v4 · Vercel

---

## Arquitectura Actual

```
betiq-app/
├── app/
│   ├── dashboard/         → Vista principal (Smart Picks del día) — PRIORIDAD #1
│   ├── picks/             → Historial de apuestas del usuario
│   ├── bankroll/          → Gestión de bankroll
│   ├── trends/            → Analytics: ROI, win rate, calibración
│   ├── arbitrage/         → Scanner de arbitraje
│   ├── value-bets/        → Todas las value bets del día
│   ├── teams/             → Vista de equipos (básica)
│   ├── api/cron/          → 3 endpoints de cron jobs (protegidos con CRON_SECRET)
│   │   ├── refresh-odds/  → Actualiza odds cada 6h
│   │   ├── sync-scores/   → Sincroniza resultados
│   │   └── send-picks/    → Envía picks por Telegram
│   └── actions/           → Server Actions: bets.ts, snapshots.ts
├── components/
│   ├── value-bets/PickCard.tsx    → Card principal de un pick (rediseñar en v3)
│   ├── picks/BetCard.tsx          → Card de apuesta registrada
│   ├── bankroll/BankrollWidget.tsx
│   ├── Sidebar.tsx                → Navegación desktop
│   └── BottomNav.tsx              → Navegación mobile
├── lib/
│   ├── algorithms/
│   │   ├── value-bet-calculator.ts  → Motor principal (855 líneas) — NO TOCAR sin tests
│   │   └── arbitrage-scanner.ts
│   ├── apis/
│   │   ├── odds-api.ts              → The Odds API + SPORT_SCHEDULE
│   │   ├── key-manager.ts           → Rotación automática de ~10 API keys free
│   │   └── sofascore.ts             → Form de equipos (enriquecimiento)
│   ├── notifications/telegram.ts    → Bot de Telegram (ROTO — fix en M3)
│   └── supabase/                    → Clientes server/client/admin
└── docs/                            → Este directorio — specs por módulo
```

---

## Base de Datos (Supabase)

### Tablas

| Tabla | Descripción | RLS |
|---|---|---|
| `profiles` | `bankroll_actual`, `bankroll_inicial` por usuario | ✅ Por user_id |
| `bets` | Historial: `status`, `stake`, `odds`, `profit`, `sport`, `market`, `confidence` | ✅ Por user_id |
| `api_key_usage` | Tracking de rotación de keys — compartida entre todos los usuarios | 🔐 Solo service role |
| `odds_snapshots` | Cuotas históricas por evento/bookmaker (cada 5h) | 🔐 Solo service role |
| `auth_otp` | [NUEVO v3] OTPs de verificación de email (TTL 5 min) | 🔐 Solo service role |
| `pick_reasoning` | [NUEVO v3] Reasoning de Gemini cacheado (TTL 6h por eventId) | 🔐 Solo service role |

### Schema inferido de `odds_snapshots`
```sql
-- Inferido de app/actions/snapshots.ts — VERIFICAR contra BD real antes de usar
CREATE TABLE odds_snapshots (
  event_id      text,
  event_label   text,
  sport_key     text,
  bookmaker_key text,
  market_key    text,
  outcome_name  text,
  odds          numeric,
  recorded_at   timestamptz,
  PRIMARY KEY (event_id, bookmaker_key, market_key, outcome_name, recorded_at)
);
```

---

## Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # Solo server — NUNCA en cliente

# The Odds API (rotación automática)
THE_ODDS_API_KEYS=key1,key2,...     # ~10 cuentas free separadas por coma
CRON_SECRET=                         # Bearer token para endpoints de cron

# Telegram (REVISAR en Vercel — posiblemente no configuradas)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# [NUEVO v3] Gemini
GOOGLE_GENERATIVE_AI_API_KEY=       # Google AI Pro — gemini-2.0-flash

# [NUEVO v3] Email OTP
RESEND_API_KEY=                      # Resend.com — gratuito hasta 3k/mes
```

---

## APIs Externas

### The Odds API
- 500 req/mes por cuenta × ~10 cuentas = ~5000 req/mes total
- Rotación automática en `lib/apis/key-manager.ts` (persiste en `api_key_usage`)
- **PROBLEMA ACTUAL:** Dashboard llama `getUpcomingMatches()` en cada page render
  → Solución v3: Dashboard lee desde `odds_snapshots` en Supabase, NO de la API directa

### Deportes activos (SPORT_SCHEDULE)
```
baseball_mlb               → Hasta 2026-10-31
basketball_nba             → INACTIVO hasta 2026-10-01 (automático)
basketball_wnba            → ELIMINAR — no requerida
soccer_usa_mls, soccer_brazil_campeonato, soccer_argentina_primera
soccer_epl, soccer_spain_la_liga, soccer_germany_bundesliga
soccer_italy_serie_a, soccer_france_ligue_one, soccer_uefa_champs_league
```

### Cron Jobs (SIEMPRE via cron-job.org — NO via vercel.json)
```
/api/cron/refresh-odds   → Cada 6h   (header Authorization: Bearer CRON_SECRET)
/api/cron/sync-scores    → Diario
/api/cron/send-picks     → Diario (15:00 CST)
```
> ⚠️ `vercel.json` tiene 3 crons que causan deploy failure en Vercel Free.
> Fix: eliminar la sección `crons` de vercel.json.

---

## Motor de Análisis (CORE — leer antes de modificar)

**Archivo:** `lib/algorithms/value-bet-calculator.ts`

Una value bet existe cuando: `(probabilidad_real × cuota_ofrecida) - 1 > 0`

**Flujo:**
1. `removeVig(odds[])` — elimina margen del bookmaker
2. Calcula `fairProb` ponderada por sharp books (Pinnacle=3x, Betfair=2.5x, etc.)
3. `calculateValuePercentage(prob, odds)` — edge en %
4. Sistema de Zonas: A(1.50-1.95)=siempre, B(1.96-2.50)=value≥5%, C(>2.50)=value≥10%+Pinnacle
5. `calculateKellyCriterion(prob, odds, 0.25)` — stake sugerido (cap 5% bankroll)
6. `getSmartPicks()` — mejor pick por partido
7. `enrichPicksWithStats()` — boost si racha del equipo ≥70% (SofaScore)

---

## Módulos v3.0

### M0: `foundation` — PREREQUISITO DE TODO
**Spec:** `docs/modules/FOUNDATION.md`
- Auth obligatoria en todas las rutas (middleware.ts)
- OTP de 6 dígitos via Resend en lugar de Supabase magic link
- Eliminar `basketball_wnba` de SPORT_SCHEDULE
- Eliminar sección `crons` de vercel.json
- Documentar schema de Supabase en `supabase/schema.sql`

### M1: `api-optimization` — CRÍTICO (ahorra dinero)
**Spec:** `docs/modules/API_OPTIMIZATION.md`
- Dashboard lee desde `odds_snapshots` (NO llama a The Odds API directamente)
- Nueva función `getDashboardData()` en `lib/data/dashboard-data.ts`
- Caché con `unstable_cache` (revalidate 30 min)

### M2: `dashboard-intelligence` — PRIORIDAD #1 VISUAL
**Spec:** `docs/modules/DASHBOARD_INTELLIGENCE.md`
- Reasoning en español para cada pick via Gemini Flash
- Caché de reasoning en tabla `pick_reasoning` (no re-generar en 6h)
- Rediseño visual de PickCard (glassmorphism, confidence visual, bookmaker pills)
- Nuevo layout del Dashboard

### M3: `telegram-fix` — MEDIA PRIORIDAD
**Spec:** `docs/modules/TELEGRAM_FIX.md`
- Cambiar formato de mensajes de MarkdownV2 a HTML (más robusto)
- Endpoint de test: `GET /api/admin/test-telegram`
- Verificar env vars en Vercel

### M4: `live-engine` — POST M0-M2
**Spec:** `docs/modules/LIVE_ENGINE.md`
- Server-Sent Events para updates sin recargar
- PWA manifest + Service Worker
- Push notifications

---

## Decisiones Arquitectónicas (NO negociar sin discutir)

1. **Auth OTP:** Usar Resend para enviar OTP de 6 dígitos. NO usar Supabase magic link.
2. **Dashboard data:** Lee desde `odds_snapshots` en Supabase. NUNCA llama The Odds API directamente.
3. **Cron jobs:** Siempre vía cron-job.org. Eliminar `vercel.json crons`.
4. **Gemini reasoning:** Siempre cachear en `pick_reasoning`. Nunca llamar en cada render.
5. **WNBA:** No incluir. No agregar sin instrucción explícita.
6. **Multi-usuario:** RLS habilitado en todas las tablas de usuario. Actualmente 1 usuario real.
7. **No bloquear apuestas:** El Discipline Coach solo avisa, no bloquea.

---

## Convenciones de Código

- TypeScript strict — sin `any` explícito
- Server Components por defecto; `'use client'` solo cuando sea estrictamente necesario
- Variables CSS para colores: `--accent-green`, `--accent-gold`, `--accent-blue`, `--accent-red`
- TailwindCSS v4 para nuevos estilos — no inline styles en componentes nuevos
- Leer `node_modules/next/dist/docs/` antes de usar cualquier API de Next.js

---

## Uso Paralelo

Para trabajar en módulos simultáneamente:
1. Abrir un chat nuevo por módulo
2. Pegar este archivo como contexto al inicio: `docs/BETIQ_V3_CONTEXT.md`
3. Indicar el módulo: "Trabaja en el módulo M1: api-optimization. Lee docs/modules/API_OPTIMIZATION.md"
4. El agente es autosuficiente: planifica, implementa, prueba, commitea

Módulos paralelos posibles: M0 + M1 (no comparten archivos)
Secuenciales obligatorios: M0 → M2, M0 → M3, M2 → M4
