/**
 * BetIQ Sent Picks Store
 *
 * CRUD helpers para la tabla `sent_picks` en Supabase.
 * Registra qué picks se enviaron por Telegram para:
 *   - Evitar duplicados (no enviar el mismo pick dos veces en un día)
 *   - Tracking histórico de notificaciones
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTodayDateString(): string {
  // Usar zona horaria de México para determinar "hoy"
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Guarda los picks enviados en la tabla `sent_picks`.
 * Usa upsert para no fallar si se ejecuta dos veces.
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
      pick_label:        pick.bestPick,
      market:            pick.bestMarket,
      best_odds:         pick.bestOdds,
      value_pct:         pick.valuePercentage,
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
 * Verifica si un pick específico ya fue enviado hoy (cualquier tipo).
 */
export async function wasPickAlreadySent(
  eventId: string,
  pickLabel: string
): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const today = getTodayDateString();

    const { data } = await supabase
      .from('sent_picks')
      .select('id')
      .eq('sent_date', today)
      .eq('event_id', eventId)
      .eq('pick_label', pickLabel)
      .maybeSingle();

    return !!data;
  } catch {
    return false;
  }
}
