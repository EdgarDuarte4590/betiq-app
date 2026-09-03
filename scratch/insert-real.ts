import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const files = [
  'C:\\Users\\Ema\\.gemini\\antigravity-ide\\brain\\dd86eaad-0564-4bbc-98a2-2811ed5ede46\\.system_generated\\steps\\209\\content.md',
  'C:\\Users\\Ema\\.gemini\\antigravity-ide\\brain\\dd86eaad-0564-4bbc-98a2-2811ed5ede46\\.system_generated\\steps\\210\\content.md',
  'C:\\Users\\Ema\\.gemini\\antigravity-ide\\brain\\dd86eaad-0564-4bbc-98a2-2811ed5ede46\\.system_generated\\steps\\211\\content.md'
];

async function run() {
  let allEvents = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const parts = text.split('---');
    if (parts.length > 1) {
      try {
        const json = JSON.parse(parts[1].trim());
        allEvents.push(...json);
      } catch(e) { console.error('Failed to parse JSON', e.message) }
    }
  }

  console.log(`Total events parsed: ${allEvents.length}`);
  if(allEvents.length === 0) return;

  const nowIso = new Date().toISOString();
  const rows = allEvents.flatMap(event =>
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

  console.log(`Inserting ${rows.length} rows`);
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await supabase.from('odds_snapshots').insert(batch);
    if (error) console.error(error);
  }
  console.log('Done!');
}
run();
