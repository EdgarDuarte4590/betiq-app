# Módulo: `foundation` — Auth, Cleanup, DB

## Objetivo
Habilitar auth obligatoria en toda la app con OTP propio (no magic link de Supabase),
eliminar deuda técnica, y preparar la infraestructura para múltiples usuarios.

## Contexto requerido
Leer `docs/BETIQ_V3_CONTEXT.md` completo antes de empezar.

## Tareas

### T0.1 — Eliminar basketball_wnba del SPORT_SCHEDULE
- **Archivo:** `lib/apis/odds-api.ts`
- **Cambio:** Borrar la línea `{ key: 'basketball_wnba', ... }`
- **Verificar:** `getActiveSports()` no retorna `basketball_wnba`

### T0.2 — Eliminar crons de vercel.json
- **Archivo:** `vercel.json`
- **Cambio:** Eliminar la sección `"crons": [...]` completa
- **Resultado:** `vercel.json` queda vacío o solo con rewrites si los hay
- **Verificar:** Deploy en Vercel no da error de crons

### T0.3 — Habilitar auth en middleware.ts
- **Archivo:** `middleware.ts`
- Rutas protegidas (requieren sesión): `/dashboard`, `/picks`, `/bankroll`, `/trends`, `/arbitrage`, `/value-bets`, `/teams`
- Rutas públicas: `/`, `/login`, `/register`, `/api/cron/*`, `/api/auth/*`
- Si no hay sesión → redirect a `/login?redirect=<path>`
- Usar `@supabase/ssr` para leer la sesión (patrón ya en `lib/supabase/middleware.ts`)

### T0.4 — Quitar auth deshabilitada en todas las páginas
- **Archivos:**
  - `app/dashboard/page.tsx` — línea 16: `// if (!user) redirect('/login');`
  - `app/picks/page.tsx` — línea 12
  - `app/bankroll/page.tsx` — similar
  - `app/trends/page.tsx` — línea 9
- **Cambio:** Descomentar los redirects + eliminar los fallbacks de demo mode DENTRO de las páginas
- **Mantener:** El banner de "Modo Demo" en `app/page.tsx` (la landing pública)

### T0.5 — Nuevo flujo de login con OTP
- **Instalar:** `npm install resend`
- **Archivos nuevos:**
  - `app/api/auth/send-otp/route.ts` — Genera OTP 6 dígitos, guarda en `auth_otp` Supabase, envía por Resend
  - `app/api/auth/verify-otp/route.ts` — Verifica OTP, crea sesión Supabase con `signInWithPassword` o `setSession`
- **Modificar:** `app/login/page.tsx` — Nuevo UI: campo de email → botón → campo OTP → verificar
- **Tabla Supabase a crear:**
  ```sql
  CREATE TABLE auth_otp (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL,
    otp_hash    text NOT NULL,  -- SHA-256 del OTP (no guardar en texto plano)
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    used        boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ON auth_otp(email, expires_at);
  -- RLS: solo service role puede leer/escribir
  ALTER TABLE auth_otp ENABLE ROW LEVEL SECURITY;
  ```

### T0.6 — Documentar schema completo de Supabase
- **Archivo:** `supabase/schema.sql`
- Incluir todas las tablas conocidas (verificar contra BD real con Supabase dashboard)
- Incluir RLS policies
- Este archivo es referencia — no se ejecuta automáticamente

## Verificación
```bash
npm run build     # 0 TypeScript errors
npm run lint      # 0 ESLint errors
```
- [ ] Acceder a `/dashboard` sin sesión → redirige a `/login`
- [ ] Login con email → recibir OTP → entrar al dashboard
- [ ] Vercel deploy sin error de crons
- [ ] WNBA no aparece en ningún log de `getActiveSports()`
