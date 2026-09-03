import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import type { OddEvent, Bookmaker, Market, Outcome } from './lib/apis/odds-api';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function test() {
  console.log('Fetching latest snapshot...');
  const { data: latestRow } = await supabase
    .from('odds_snapshots')
    .select('recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) return console.log('No snapshots');

  const cutoffIso = new Date(new Date(latestRow.recorded_at).getTime() - 30 * 60000).toISOString();
  console.log(`Cutoff: ${cutoffIso}`);

  const { count } = await supabase
    .from('odds_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('recorded_at', cutoffIso);

  console.log(`Total rows to fetch: ${count}`);
  if (!count) return;

  const pageSize = 1000;
  const pages = Math.ceil(count / pageSize);
  const fetchPromises = [];

  for (let i = 0; i < pages; i++) {
    const from = i * pageSize;
    const to = from + pageSize - 1;
    fetchPromises.push(
      supabase
        .from('odds_snapshots')
        .select('event_id, event_label, sport_key, bookmaker_key, market_key, outcome_name, odds, recorded_at')
        .gte('recorded_at', cutoffIso)
        .order('recorded_at', { ascending: false })
        .range(from, to)
    );
  }

  const results = await Promise.all(fetchPromises);
  const rows = results.flatMap(res => res.data || []);
  console.log(`Fetched ${rows.length} rows`);
  
  // Try to group them to see how many bookmakers per event
  const events = new Set();
  const eventBookmakers = new Map();
  for (const row of rows) {
    events.add(row.event_id);
    if (!eventBookmakers.has(row.event_id)) eventBookmakers.set(row.event_id, new Set());
    eventBookmakers.get(row.event_id).add(row.bookmaker_key);
  }
  
  console.log(`Unique events: ${events.size}`);
  let validEvents = 0;
  for (const [eventId, bks] of eventBookmakers.entries()) {
    if (bks.size >= 2) validEvents++;
  }
  console.log(`Events with >= 2 bookies: ${validEvents}`);
}
test();
