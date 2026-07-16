/**
 * BetIQ API Key Manager v1.0
 *
 * Gestiona la rotación automática de múltiples API keys de The Odds API.
 * Estado persistido en Supabase (tabla: api_key_usage) para sobrevivir
 * entre cold starts de Vercel y deploys.
 *
 * Estrategia de rotación:
 *   1. Carga todas las keys desde THE_ODDS_API_KEYS (CSV en .env.local)
 *   2. Consulta Supabase para saber cuántas requests ha usado cada una
 *   3. Selecciona la key con menor uso que no esté marcada como agotada
 *   4. Si la key llega a >= ROTATION_THRESHOLD (490), pasa a la siguiente
 *   5. Si una key retorna 401/429, se marca como is_exhausted = true
 *   6. Reset automático al inicio de cada mes (The Odds API resetea mensualmente)
 */

import { createClient } from '@supabase/supabase-js';

// ── Constantes ──────────────────────────────────────────────────────────────

/** Threshold de requests: rotar ANTES de agotar la cuota mensual */
const ROTATION_THRESHOLD = 490; // de 500 máx — margen de 10 para errores

/** Nombre de la tabla de tracking en Supabase */
const TABLE = 'api_key_usage';

// ── Cliente de Supabase (admin, sin auth de usuario) ────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[KeyManager] Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

// ── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Genera un hash simple (no criptográfico) de la key para no guardarla en texto plano.
 * Usamos los primeros 8 + últimos 4 caracteres como identificador legible.
 */
function keyToHash(apiKey: string): string {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

/**
 * Lee todas las API keys desde THE_ODDS_API_KEYS (separadas por coma).
 * Si no existe, usa THE_ODDS_API_KEY como fallback de una sola key.
 */
export function loadApiKeys(): string[] {
  const multiKeys = process.env.THE_ODDS_API_KEYS;
  if (multiKeys) {
    const keys = multiKeys.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  // Fallback: key única legacy
  const singleKey = process.env.THE_ODDS_API_KEY;
  if (singleKey) return [singleKey];
  return [];
}

// ── Tipos ───────────────────────────────────────────────────────────────────

interface KeyUsageRow {
  key_hash:      string;
  requests_used: number;
  last_used_at:  string | null;
  reset_at:      string;
  is_exhausted:  boolean;
  created_at:    string;
  updated_at:    string;
}

export interface KeyStatus {
  keyHash:       string;
  requestsUsed:  number;
  requestsLeft:  number;
  isExhausted:   boolean;
  lastUsedAt:    string | null;
  resetAt:       string;
}

// ── Funciones Principales ────────────────────────────────────────────────────

/**
 * Inicializa los registros de tracking para todas las keys.
 * Si una key ya existe en la tabla, no la sobreescribe.
 * Llama a esto en el startup o cuando se agregan nuevas keys.
 */
export async function initializeKeys(): Promise<void> {
  const keys = loadApiKeys();
  if (keys.length === 0) {
    console.warn('[KeyManager] No hay API keys configuradas en THE_ODDS_API_KEYS');
    return;
  }

  const supabase = getAdminClient();
  const now = new Date();
  // Reset al inicio del próximo mes
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const rows = keys.map(key => ({
    key_hash:      keyToHash(key),
    requests_used: 0,
    is_exhausted:  false,
    reset_at:      nextMonth.toISOString(),
  }));

  // Upsert: inserta si no existe, ignora si ya existe (no sobreescribe el contador)
  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: 'key_hash', ignoreDuplicates: true });

  if (error) {
    console.error('[KeyManager] Error al inicializar keys:', error.message);
  } else {
    console.log(`[KeyManager] ✅ ${keys.length} keys inicializadas/verificadas`);
  }
}

/**
 * Verifica si el contador de una key debe resetearse (nuevo mes).
 */
async function checkAndResetIfNewMonth(
  supabase: ReturnType<typeof getAdminClient>,
  keyHash: string,
  resetAt: string
): Promise<void> {
  const now = new Date();
  const resetDate = new Date(resetAt);

  if (now >= resetDate) {
    // Nuevo mes — resetear contador y fecha de reset
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await supabase.from(TABLE).update({
      requests_used: 0,
      is_exhausted:  false,
      reset_at:      nextReset.toISOString(),
    }).eq('key_hash', keyHash);

    console.log(`[KeyManager] 🔄 Key ${keyHash} reseteada para el nuevo mes`);
  }
}

/**
 * Obtiene la API key activa óptima para hacer una request.
 *
 * Selección:
 *   1. No agotada (is_exhausted = false)
 *   2. Debajo del threshold de rotación (requests_used < 490)
 *   3. Con menor número de requests usadas (para distribuir la carga)
 *
 * Returns: la API key en texto plano lista para usar, o null si todas están agotadas.
 */
export async function getActiveKey(): Promise<string | null> {
  const keys = loadApiKeys();
  if (keys.length === 0) {
    console.error('[KeyManager] No hay API keys configuradas');
    return null;
  }

  // Si solo hay una key (modo legacy), devolverla directamente
  if (keys.length === 1) return keys[0];

  try {
    const supabase = getAdminClient();

    // Obtener estado de todas las keys conocidas
    const hashes = keys.map(k => keyToHash(k));
    const { data: rows, error } = await supabase
      .from(TABLE)
      .select('*')
      .in('key_hash', hashes)
      .order('requests_used', { ascending: true });

    if (error) {
      console.error('[KeyManager] Error consultando BD, usando primera key:', error.message);
      return keys[0];
    }

    // Si no hay registros aún, inicializar y devolver la primera
    if (!rows || rows.length === 0) {
      await initializeKeys();
      return keys[0];
    }

    const usageMap = new Map<string, KeyUsageRow>(
      (rows as KeyUsageRow[]).map(r => [r.key_hash, r])
    );

    // Verificar resets de mes para cada key
    for (const row of rows as KeyUsageRow[]) {
      await checkAndResetIfNewMonth(supabase, row.key_hash, row.reset_at);
    }

    // Buscar la mejor key disponible (menor uso, no agotada, bajo el threshold)
    for (const key of keys) {
      const hash = keyToHash(key);
      const usage = usageMap.get(hash);

      // Si no tiene registro en BD, está sin usar → es perfecta
      if (!usage) return key;

      // Saltar si está agotada o sobre el threshold
      if (usage.is_exhausted) continue;
      if (usage.requests_used >= ROTATION_THRESHOLD) continue;

      // ¡Esta key está disponible!
      console.log(`[KeyManager] 🔑 Usando key ${hash} (${usage.requests_used}/${ROTATION_THRESHOLD} requests usadas)`);
      return key;
    }

    // Todas las keys están sobre el threshold o agotadas
    console.error('[KeyManager] ⚠️ TODAS las keys han alcanzado el límite este mes.');
    // Como último recurso, devolver la menos usada aunque esté sobre el threshold
    const leastUsed = (rows as KeyUsageRow[])
      .filter(r => !r.is_exhausted)
      .sort((a, b) => a.requests_used - b.requests_used)[0];

    if (leastUsed) {
      const key = keys.find(k => keyToHash(k) === leastUsed.key_hash);
      return key ?? null;
    }

    return null;
  } catch (err) {
    console.error('[KeyManager] Error inesperado, usando primera key como fallback:', err);
    return keys[0];
  }
}

/**
 * Actualiza el contador de requests de una key después de una llamada a la API.
 * También lee el header x-requests-remaining para mantener el contador exacto.
 *
 * @param apiKey       - La key en texto plano que se usó
 * @param responseHeaders - Headers de respuesta de The Odds API (opcional pero recomendado)
 */
export async function recordKeyUsage(
  apiKey: string,
  responseHeaders?: Headers
): Promise<void> {
  try {
    const supabase = getAdminClient();
    const hash = keyToHash(apiKey);

    // Intentar leer el valor exacto de requests usadas desde los headers de la API
    let exactUsed: number | null = null;
    if (responseHeaders) {
      const remaining = responseHeaders.get('x-requests-remaining');
      const used      = responseHeaders.get('x-requests-used');
      if (used !== null)      exactUsed = parseInt(used, 10);
      else if (remaining !== null) exactUsed = 500 - parseInt(remaining, 10);
    }

    if (exactUsed !== null && !isNaN(exactUsed)) {
      // Actualización exacta (más confiable)
      await supabase.from(TABLE).upsert({
        key_hash:      hash,
        requests_used: exactUsed,
        last_used_at:  new Date().toISOString(),
        is_exhausted:  exactUsed >= 500,
      }, { onConflict: 'key_hash' });
    } else {
      // Incremento +1 si no tenemos los headers
      await supabase.rpc('increment_key_usage', { p_key_hash: hash }).throwOnError();
    }
  } catch (err) {
    // No bloquear la ejecución por un fallo de tracking
    console.warn('[KeyManager] No se pudo registrar uso de key:', err);
  }
}

/**
 * Marca una key como agotada/bloqueada (ej. cuando retorna 401 o 429).
 */
export async function markKeyExhausted(apiKey: string): Promise<void> {
  try {
    const supabase = getAdminClient();
    const hash = keyToHash(apiKey);

    await supabase.from(TABLE).update({
      is_exhausted:  true,
      last_used_at:  new Date().toISOString(),
    }).eq('key_hash', hash);

    console.warn(`[KeyManager] 🚫 Key ${hash} marcada como agotada`);
  } catch (err) {
    console.error('[KeyManager] Error al marcar key como agotada:', err);
  }
}

/**
 * Retorna el estado de todas las keys (para mostrar en un panel de admin).
 */
export async function getAllKeyStatuses(): Promise<KeyStatus[]> {
  const keys = loadApiKeys();
  if (keys.length === 0) return [];

  try {
    const supabase = getAdminClient();
    const hashes = keys.map(k => keyToHash(k));
    const { data: rows } = await supabase
      .from(TABLE)
      .select('*')
      .in('key_hash', hashes)
      .order('requests_used', { ascending: true });

    if (!rows) return [];

    return (rows as KeyUsageRow[]).map(r => ({
      keyHash:      r.key_hash,
      requestsUsed: r.requests_used,
      requestsLeft: Math.max(0, 500 - r.requests_used),
      isExhausted:  r.is_exhausted,
      lastUsedAt:   r.last_used_at,
      resetAt:      r.reset_at,
    }));
  } catch {
    return [];
  }
}
