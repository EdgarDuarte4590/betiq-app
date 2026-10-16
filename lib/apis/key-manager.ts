/**
 * BetIQ Smart API Key Manager v3.2
 *
 * Gestiona la rotación automática y persistente de múltiples API keys de The Odds API.
 * Estado persistido en Supabase (tabla: api_key_usage) usando el cliente administrativo
 * (lib/supabase/admin.ts) para sobrevivir entre cold starts de Vercel y deploys.
 *
 * Estrategia de rotación institucional:
 *   1. Carga todas las keys desde THE_ODDS_API_KEYS (CSV) o THE_ODDS_API_KEY
 *   2. Consulta Supabase para conocer el uso exacto (basado en x-requests-remaining)
 *   3. Selecciona la key activa con menor uso y bajo ROTATION_THRESHOLD (490)
 *   4. Rota inmediatamente ante códigos HTTP 401, 402 o 429
 *   5. Reset automático al inicio de cada mes calendario
 */

import { createAdminClient } from '@/lib/supabase/admin';

// ── Constantes ──────────────────────────────────────────────────────────────

const MONTHLY_QUOTA = 500;
/** Threshold de requests: rotar ANTES de agotar la cuota mensual */
const ROTATION_THRESHOLD = 490;

/** Nombre de la tabla de tracking en Supabase */
const TABLE = 'api_key_usage';

// Tracking complementario de errores por instancia + cálculo de métricas extendidas
const errorCountMemory = new Map<string, number>();

// ── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Genera un identificador enmascarado determinista de la key.
 */
export function keyToHash(apiKey: string): string {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

/**
 * Lee todas las API keys desde THE_ODDS_API_KEYS (separadas por coma).
 * Si no existe, usa THE_ODDS_API_KEY como fallback.
 */
export function loadApiKeys(): string[] {
  const multiKeys = process.env.THE_ODDS_API_KEYS;
  if (multiKeys) {
    const keys = multiKeys.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const singleKey = process.env.THE_ODDS_API_KEY;
  if (singleKey) return [singleKey.trim()];
  return [];
}

// ── Tipos ───────────────────────────────────────────────────────────────────

interface KeyUsageRow {
  key_hash:      string;
  requests_used: number;
  last_used_at:  string | null;
  reset_at:      string;
  is_exhausted:  boolean;
  created_at?:   string;
  updated_at?:   string;
}

export interface KeyStatus {
  keyHash:           string;
  requestsUsed:      number;
  requestsLeft:      number;
  requestsRemaining: number;
  isExhausted:       boolean;
  exhaustedUntil:    string | null;
  errorCount:        number;
  lastUsedAt:        string | null;
  resetAt:           string;
}

// ── Funciones Principales ────────────────────────────────────────────────────

/**
 * Inicializa los registros de tracking para todas las keys configuradas.
 */
export async function initializeKeys(): Promise<void> {
  const keys = loadApiKeys();
  if (keys.length === 0) {
    console.warn('[KeyManager] No hay API keys configuradas en THE_ODDS_API_KEYS');
    return;
  }

  try {
    const supabase = createAdminClient();
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const rows = keys.map(key => ({
      key_hash:      keyToHash(key),
      requests_used: 0,
      is_exhausted:  false,
      reset_at:      nextMonth.toISOString(),
    }));

    const { error } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: 'key_hash', ignoreDuplicates: true });

    if (error) {
      console.error('[KeyManager] Error al inicializar keys:', error.message);
    }
  } catch (err) {
    console.warn('[KeyManager] Error inesperado en initializeKeys:', err);
  }
}

/**
 * Verifica si el contador de una key debe resetearse (nuevo mes).
 */
async function checkAndResetIfNewMonth(
  supabase: ReturnType<typeof createAdminClient>,
  row: KeyUsageRow
): Promise<KeyUsageRow> {
  const now = new Date();
  const resetDate = new Date(row.reset_at);

  if (now >= resetDate) {
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextIso = nextReset.toISOString();
    await supabase.from(TABLE).update({
      requests_used: 0,
      is_exhausted:  false,
      reset_at:      nextIso,
    }).eq('key_hash', row.key_hash);

    errorCountMemory.set(row.key_hash, 0);
    console.log(`[KeyManager] 🔄 Key ${row.key_hash} reseteada para el nuevo mes`);
    return {
      ...row,
      requests_used: 0,
      is_exhausted: false,
      reset_at: nextIso,
    };
  }
  return row;
}

/**
 * Obtiene la API key activa óptima para hacer una request.
 * Opcionalmente excluye keys que hayan fallado en la corrida actual.
 */
export async function getActiveKey(excludeKeys: Set<string> = new Set()): Promise<string | null> {
  const keys = loadApiKeys().filter(k => !excludeKeys.has(k));
  if (keys.length === 0) {
    console.error('[KeyManager] No hay API keys disponibles');
    return null;
  }

  try {
    const supabase = createAdminClient();
    const hashes = keys.map(k => keyToHash(k));

    const { data: rows, error } = await supabase
      .from(TABLE)
      .select('*')
      .in('key_hash', hashes)
      .order('requests_used', { ascending: true });

    if (error) {
      console.error('[KeyManager] Error consultando BD, usando primera key disponible:', error.message);
      return keys[0];
    }

    if (!rows || rows.length === 0) {
      await initializeKeys();
      return keys[0];
    }

    const updatedRows: KeyUsageRow[] = [];
    for (const rawRow of rows as KeyUsageRow[]) {
      const checked = await checkAndResetIfNewMonth(supabase, rawRow);
      updatedRows.push(checked);
    }

    const usageMap = new Map<string, KeyUsageRow>(
      updatedRows.map(r => [r.key_hash, r])
    );

    // Ordenar las keys candidatas por menor uso registrado
    const sortedCandidates = [...keys].sort((a, b) => {
      const uA = usageMap.get(keyToHash(a))?.requests_used ?? 0;
      const uB = usageMap.get(keyToHash(b))?.requests_used ?? 0;
      return uA - uB;
    });

    for (const key of sortedCandidates) {
      const hash = keyToHash(key);
      const usage = usageMap.get(hash);

      if (!usage) return key;
      if (usage.is_exhausted) continue;
      if (usage.requests_used >= ROTATION_THRESHOLD) continue;

      return key;
    }

    // Fallback: si todas superaron ROTATION_THRESHOLD (490), usar alguna no marcada como is_exhausted (< 500)
    const fallbackRow = updatedRows
      .filter(r => !r.is_exhausted && r.requests_used < MONTHLY_QUOTA)
      .sort((a, b) => a.requests_used - b.requests_used)[0];

    if (fallbackRow) {
      const key = keys.find(k => keyToHash(k) === fallbackRow.key_hash);
      if (key) return key;
    }

    console.error('[KeyManager] ⚠️ TODAS las API keys están agotadas este mes.');
    return null;
  } catch (err) {
    console.error('[KeyManager] Error inesperado en getActiveKey:', err);
    return keys[0] ?? null;
  }
}

/**
 * Actualiza el contador de requests de una key después de una llamada a la API.
 * Lee `x-requests-remaining` y `x-requests-used` de los headers de The Odds API.
 */
export async function recordKeyUsage(
  apiKey: string,
  responseHeaders?: Headers
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const hash = keyToHash(apiKey);
    const nowIso = new Date().toISOString();
    const now = new Date();
    const nextMonthIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

    let exactUsed: number | null = null;
    let remainingCount: number | null = null;

    if (responseHeaders) {
      const remainingHeader = responseHeaders.get('x-requests-remaining');
      const usedHeader      = responseHeaders.get('x-requests-used');

      if (remainingHeader !== null) {
        const parsedRem = parseInt(remainingHeader, 10);
        if (!isNaN(parsedRem)) {
          remainingCount = parsedRem;
          exactUsed = Math.max(0, MONTHLY_QUOTA - parsedRem);
        }
      }
      if (usedHeader !== null && exactUsed === null) {
        const parsedUsed = parseInt(usedHeader, 10);
        if (!isNaN(parsedUsed)) {
          exactUsed = parsedUsed;
        }
      }
    }

    if (exactUsed !== null) {
      const isExhausted = (remainingCount !== null && remainingCount <= 0) || exactUsed >= MONTHLY_QUOTA;
      await supabase.from(TABLE).upsert({
        key_hash:      hash,
        requests_used: exactUsed,
        last_used_at:  nowIso,
        is_exhausted:  isExhausted,
        reset_at:      nextMonthIso,
      }, { onConflict: 'key_hash' });
    } else {
      // Fallback sin RPC: leer uso actual e incrementar +1
      const { data: current } = await supabase
        .from(TABLE)
        .select('requests_used')
        .eq('key_hash', hash)
        .maybeSingle();

      const nextUsed = (current?.requests_used ?? 0) + 1;
      await supabase.from(TABLE).upsert({
        key_hash:      hash,
        requests_used: nextUsed,
        last_used_at:  nowIso,
        is_exhausted:  nextUsed >= MONTHLY_QUOTA,
        reset_at:      nextMonthIso,
      }, { onConflict: 'key_hash' });
    }
  } catch (err) {
    console.warn('[KeyManager] No se pudo registrar uso de key:', err);
  }
}

/**
 * Marca una key como agotada/bloqueada ante códigos HTTP 401, 402 o 429.
 */
export async function markKeyExhausted(apiKey: string, statusCode?: number): Promise<void> {
  try {
    const supabase = createAdminClient();
    const hash = keyToHash(apiKey);
    errorCountMemory.set(hash, (errorCountMemory.get(hash) ?? 0) + 1);

    await supabase.from(TABLE).update({
      is_exhausted:  true,
      requests_used: MONTHLY_QUOTA,
      last_used_at:  new Date().toISOString(),
    }).eq('key_hash', hash);

    console.warn(`[KeyManager] 🚫 Key ${hash} marcada como agotada (HTTP ${statusCode ?? '401/402/429'})`);
  } catch (err) {
    console.error('[KeyManager] Error al marcar key como agotada:', err);
  }
}

/**
 * Retorna el estado detallado de todas las keys para telemetría y /api/admin/status.
 */
export async function getAllKeyStatuses(): Promise<KeyStatus[]> {
  const keys = loadApiKeys();
  if (keys.length === 0) return [];

  try {
    const supabase = createAdminClient();
    const hashes = keys.map(k => keyToHash(k));
    const { data: rows } = await supabase
      .from(TABLE)
      .select('*')
      .in('key_hash', hashes)
      .order('requests_used', { ascending: true });

    if (!rows) return [];

    return (rows as KeyUsageRow[]).map(r => {
      const remaining = r.is_exhausted ? 0 : Math.max(0, MONTHLY_QUOTA - r.requests_used);
      return {
        keyHash:           r.key_hash,
        requestsUsed:      r.requests_used,
        requestsLeft:      remaining,
        requestsRemaining: remaining,
        isExhausted:       r.is_exhausted,
        exhaustedUntil:    r.is_exhausted ? r.reset_at : null,
        errorCount:        errorCountMemory.get(r.key_hash) ?? (r.is_exhausted ? 1 : 0),
        lastUsedAt:        r.last_used_at,
        resetAt:           r.reset_at,
      };
    });
  } catch {
    return [];
  }
}
