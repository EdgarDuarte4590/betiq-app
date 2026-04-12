'use server';
import { createClient } from '@/lib/supabase/server';
import { OddEvent } from '@/lib/apis/odds-api';

export async function saveOddsSnapshot(events: OddEvent[]) {
  const supabase = await createClient();
  const now = new Date().toISOString();
  
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
          recorded_at: now,
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
