/**
 * BetIQ Sent Picks Store v4.0
 *
 * CRUD e Idempotencia Determinista para la tabla `sent_picks` en Supabase.
 * - Usa exclusivamente `createAdminClient()` (Service Role Key) para evitar bloqueos RLS en Crons.
 * - Llave de idempotencia determinista: `match_id + market + selection` (`event_id::market::pick_label`).
 * - Permite re-alertar únicamente si el EV% mejora en >= 2.5% respecto al envío previo.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = 'daily_digest' | 'pre_game_alert';

export interface SentPick {
  id: number;
  sent_date: string;
  event_id: string;
  event_label: string;
  sport_key: string;
  pick_label: string;
  market: string;
  best_odds: number;
  value_pct: number;
  confidence: string;
  commence_time: string;
  notification_type: NotificationType;
  sent_at: string;
}

/** Umbral mínimo de mejora de EV% para re-alertar un mismo pick */
export const RE_ALERT_EV_DELTA_THRESHOLD = 2.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

/**
 * Construye la llave de idempotencia determinista:
 *   match_id + market + selection
 * Normaliza emojis de racha (ej. "🔥") para que no generen falsos positivos.
 */
export function buildPickIdempotencyKey(
  eventId: string,
  market: string,
  pickLabel: string
): string {
  const cleanMarket = (market || 'H2H').trim().toLowerCase();
  const cleanSelection = (pickLabel || '')
    .replace(/🔥/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${eventId}::${cleanMarket}::${cleanSelection}`;
}

/**
 * Filtra los picks candidatos contra los ya enviados hoy:
 * - Si no existe la llave `match_id + market + selection`, se permite enviar.
 * - Si ya existe, SOLO se permite re-alertar si el EV% mejoró en >= 2.5% respecto al máximo enviado hoy.
 */
export function filterDeduplicatedPicks(
  candidates: SmartPick[],
  alreadySent: SentPick[]
): {
  allowedPicks: SmartPick[];
  alreadySentCount: number;
  upgradedEvCount: number;
} {
  // Mapa de llave determinista -> máximo value_pct enviado hoy
  const sentMaxEvMap = new Map<string, number>();

  for (const s of alreadySent) {
    const key = buildPickIdempotencyKey(s.event_id, s.market, s.pick_label);
    const prevEv = typeof s.value_pct === 'number' ? s.value_pct : parseFloat(String(s.value_pct || '0'));
    const existing = sentMaxEvMap.get(key);
    if (existing === undefined || prevEv > existing) {
      sentMaxEvMap.set(key, prevEv);
    }
  }

  const allowedPicks: SmartPick[] = [];
  let alreadySentCount = 0;
  let upgradedEvCount = 0;

  for (const pick of candidates) {
    const key = buildPickIdempotencyKey(pick.eventId, pick.bestMarket, pick.bestPick);
    const prevEv = sentMaxEvMap.get(key);

    if (prevEv === undefined) {
      allowedPicks.push(pick);
    } else if (pick.valuePercentage - prevEv >= RE_ALERT_EV_DELTA_THRESHOLD) {
      // Mejora significativa de EV (>= +2.5%) → re-alertar
      upgradedEvCount++;
      allowedPicks.push(pick);
    } else {
      alreadySentCount++;
    }
  }

  return {
    allowedPicks,
    alreadySentCount,
    upgradedEvCount,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Guarda los picks enviados en la tabla `sent_picks`.
 */
export async function saveSentPicks(
  picks: SmartPick[],
  type: NotificationType
): Promise<void> {
  if (picks.length === 0) return;

  try {
    const supabase = createAdminClient();
    const today = getTodayDateString();
    const now = new Date().toISOString();

    const rows = picks.map(pick => ({
      sent_date:         today,
      event_id:          pick.eventId,
      event_label:       pick.event,
      sport_key:         pick.sport,
      pick_label:        pick.bestPick.replace(/🔥/g, '').trim(),
      market:            pick.bestMarket,
      best_odds:         pick.bestOdds,
      value_pct:         Number(pick.valuePercentage.toFixed(2)),
      confidence:        pick.confidence,
      commence_time:     pick.commenceTime,
      notification_type: type,
      sent_at:           now,
    }));

    const { error } = await supabase
      .from('sent_picks')
      .upsert(rows, { onConflict: 'sent_date,event_id,pick_label,notification_type' });

    if (error) {
      console.warn('[sent-picks] Error guardando sent_picks:', error.message);
    } else {
      console.log(`[sent-picks] ✅ ${rows.length} picks guardados (tipo: ${type})`);
    }
  } catch (err) {
    console.warn('[sent-picks] Error inesperado:', err);
  }
}

/**
 * Retorna todos los picks que ya se enviaron hoy (ambos tipos).
 */
export async function getTodaySentPicks(): Promise<SentPick[]> {
  try {
    const supabase = createAdminClient();
    const today = getTodayDateString();

    const { data, error } = await supabase
      .from('sent_picks')
      .select('*')
      .eq('sent_date', today);

    if (error) {
      console.warn('[sent-picks] Error leyendo sent_picks:', error.message);
      return [];
    }

    return (data ?? []) as SentPick[];
  } catch {
    return [];
  }
}

/**
 * Verifica si un pick específico ya fue enviado hoy (considerando mejora de EV >= 2.5%).
 */
export async function wasPickAlreadySent(
  eventId: string,
  pickLabel: string,
  market: string = 'H2H',
  currentValuePct?: number
): Promise<boolean> {
  try {
    const sentToday = await getTodaySentPicks();
    const targetKey = buildPickIdempotencyKey(eventId, market, pickLabel);
    const match = sentToday.find(
      s => buildPickIdempotencyKey(s.event_id, s.market, s.pick_label) === targetKey
    );

    if (!match) return false;
    if (currentValuePct !== undefined) {
      const prevEv = typeof match.value_pct === 'number' ? match.value_pct : parseFloat(String(match.value_pct || '0'));
      if (currentValuePct - prevEv >= RE_ALERT_EV_DELTA_THRESHOLD) {
        return false; // Permitir re-alerta por mejora >= 2.5%
      }
    }
    return true;
  } catch {
    return false;
  }
}
