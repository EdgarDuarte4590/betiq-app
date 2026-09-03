-- ============================================================
-- BetIQ v3.0 — Schema de Supabase
-- ============================================================
-- REFERENCIA SOLAMENTE — no ejecutar directamente.
-- El schema real puede tener diferencias. Verificar en el
-- Supabase Dashboard antes de hacer migraciones.
-- ============================================================

-- ── EXTENSIONES ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── TABLA: profiles ─────────────────────────────────────────
-- Datos del perfil de usuario (complementa auth.users de Supabase)
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bankroll_actual  numeric(12,2) NOT NULL DEFAULT 1000.00,
  bankroll_inicial numeric(12,2) NOT NULL DEFAULT 1000.00,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- RLS: cada usuario solo ve su propio perfil
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON profiles
  FOR ALL USING (auth.uid() = id);

-- Auto-crear perfil al registrar usuario
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── TABLA: bets ──────────────────────────────────────────────
-- Historial de apuestas del usuario
CREATE TABLE IF NOT EXISTS bets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event       text,                            -- "Real Madrid vs Barcelona"
  sport       text,                            -- "soccer_spain_la_liga"
  league      text,                            -- "La Liga"
  market      text        DEFAULT 'H2H',       -- "H2H" | "Totals"
  pick        text,                            -- "Gana Real Madrid"
  odds        numeric(8,2),                    -- 1.85
  stake       numeric(12,2),                   -- 50.00 (en unidades de bankroll)
  profit      numeric(12,2) DEFAULT 0,         -- ganancia/pérdida real
  status      text        NOT NULL DEFAULT 'pending',  -- pending | won | lost | void
  confidence  text,                            -- 'alta' | 'media' | 'baja'
  value_pct   numeric(8,2),                    -- % de value edge calculado
  kelly_pct   numeric(8,2),                    -- % de Kelly sugerido
  commence_time timestamptz,                   -- hora del partido
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bets_status_check CHECK (status IN ('pending', 'won', 'lost', 'void')),
  CONSTRAINT bets_confidence_check CHECK (confidence IS NULL OR confidence IN ('alta', 'media', 'baja'))
);

-- RLS: cada usuario solo ve sus apuestas
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bets_own" ON bets
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX bets_user_id_idx ON bets(user_id);
CREATE INDEX bets_status_idx  ON bets(user_id, status);

-- ── TABLA: api_key_usage ─────────────────────────────────────
-- Tracking de rotación automática de API keys de The Odds API
-- Solo accesible con service role key
CREATE TABLE IF NOT EXISTS api_key_usage (
  key_hash      text        PRIMARY KEY,       -- primeros 8 + últimos 4 chars
  requests_used int         NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  reset_at      timestamptz NOT NULL,          -- inicio del próximo mes
  is_exhausted  boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Solo service role puede acceder (no hay RLS de usuario)
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
-- Sin policies → solo service role puede leer/escribir

-- RPC para incremento atómico (usado por key-manager.ts)
CREATE OR REPLACE FUNCTION increment_key_usage(p_key_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE api_key_usage
  SET requests_used = requests_used + 1,
      last_used_at  = now(),
      updated_at    = now()
  WHERE key_hash = p_key_hash;
END;
$$;

-- ── TABLA: odds_snapshots ────────────────────────────────────
-- Snapshots históricos de cuotas (guardados por el cron refresh-odds cada 6h)
-- El Dashboard lee desde aquí — no llama a The Odds API directamente.
CREATE TABLE IF NOT EXISTS odds_snapshots (
  event_id      text        NOT NULL,
  event_label   text,                          -- "Home Team vs Away Team"
  sport_key     text,                          -- "soccer_epl"
  bookmaker_key text        NOT NULL,          -- "pinnacle"
  market_key    text        NOT NULL,          -- "h2h" | "totals"
  outcome_name  text        NOT NULL,          -- "Home" | "Away" | "Draw" | "Over 2.5"
  odds          numeric(8,4) NOT NULL,         -- 1.8500
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, bookmaker_key, market_key, outcome_name, recorded_at)
);

-- Sin RLS de usuario (solo acceso via service role desde los crons y la app server)
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;

-- Índice para queries rápidas del Dashboard (buscar el snapshot más reciente)
CREATE INDEX odds_snapshots_recorded_at_idx ON odds_snapshots(recorded_at DESC);
CREATE INDEX odds_snapshots_event_id_idx    ON odds_snapshots(event_id, recorded_at DESC);

-- ── TABLA: auth_otp ──────────────────────────────────────────
-- OTPs de verificación de email (v3.0 — reemplaza el magic link de Supabase)
CREATE TABLE IF NOT EXISTS auth_otp (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  otp_hash    text        NOT NULL,            -- SHA-256 del código de 6 dígitos
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Solo service role puede leer/escribir (no exponer OTPs a clientes)
ALTER TABLE auth_otp ENABLE ROW LEVEL SECURITY;

-- Limpiar OTPs expirados (ejecutar periódicamente o via cron)
CREATE INDEX auth_otp_email_expires_idx ON auth_otp(email, expires_at);

-- ── TABLA: pick_reasoning ────────────────────────────────────
-- Reasoning de Gemini cacheado para cada pick (v3.0)
-- Evita llamar a Gemini en cada render — se regenera máximo 1 vez/día por evento
CREATE TABLE IF NOT EXISTS pick_reasoning (
  event_id    text        NOT NULL,
  date        date        NOT NULL,            -- fecha del partido (invalida automáticamente al día siguiente)
  reasoning   text        NOT NULL,            -- texto en español generado por Gemini
  model       text        NOT NULL DEFAULT 'gemini-2.0-flash',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, date)
);

ALTER TABLE pick_reasoning ENABLE ROW LEVEL SECURITY;
CREATE INDEX pick_reasoning_date_idx ON pick_reasoning(date DESC);
