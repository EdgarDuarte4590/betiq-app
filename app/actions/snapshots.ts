'use server';
import { createClient } from '@/lib/supabase/server';
import { OddEvent } from '@/lib/apis/odds-api';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 horas

export async function saveOddsSnapshot(events: OddEvent[]) {
  const supabase = await createClient();
  const now = new Date();

  // ── Rate-limit: solo guardar si no hay snapshot reciente (< 5h) ──
  try {
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.recorded_at) {
      const lastSaved = new Date(latestRow.recorded_at).getTime();
      if (now.getTime() - lastSaved < SNAPSHOT_INTERVAL_MS) {
        console.log('[Snapshots] Snapshot reciente encontrado, omitiendo escritura.');
        return; // Ya hay un snapshot reciente, no duplicar
      }
    }
  } catch {
    // Si la tabla no existe o hay error, continuamos y guardamos
  }

  const nowIso = now.toISOString();
  const rows = events.flatMap(event =>
    event.bookmakers.flatMap(bk =>
      (bk.markets ?? []).flatMap(market =>
        (market.outcomes ?? []).map(outcome => ({
          event_id: event.id,
          event_label: `${event.home_team} vs ${event.away_team}`,
          sport_key: event.sport_key,
          bookmaker_key: bk.key,
          market_key: market.key,
          outcome_name: outcome.name,
          odds: outcome.price,
          recorded_at: nowIso,
        }))
      )
    )
  );

  if (rows.length === 0) return;

  // Upsert para no duplicar si se llama varias veces en la misma hora
  await supabase
    .from('odds_snapshots')
    .upsert(rows, { onConflict: 'event_id,bookmaker_key,market_key,outcome_name,recorded_at' });
}
