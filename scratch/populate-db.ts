import { getUpcomingMatches } from '../lib/apis/odds-api';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  console.log('Fetching matches...');
  const events = await getUpcomingMatches('upcoming');
  console.log(`Fetched ${events.length} events`);
  
  if (events.length === 0) return;
  
  const nowIso = new Date().toISOString();
  const rows = events.flatMap(event =>
    event.bookmakers.flatMap(bk =>
      (bk.markets ?? []).flatMap(market =>
        (market.outcomes ?? []).map(outcome => ({
          event_id: event.id,
          event_label: `${event.home_team} vs ${event.away_team} | ${event.commence_time}`,
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

  console.log(`Inserting ${rows.length} rows...`);
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await supabase.from('odds_snapshots').insert(batch);
    if (error) console.error('Insert error:', error);
    else console.log(`Inserted batch ${i} to ${i + batch.length}`);
  }
  console.log('Done!');
}
run();
