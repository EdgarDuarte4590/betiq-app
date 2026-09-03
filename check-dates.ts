import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkDates() {
  const { data: latestRow } = await supabase
    .from('odds_snapshots')
    .select('recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) return;

  const cutoffIso = new Date(new Date(latestRow.recorded_at).getTime() - 30 * 60000).toISOString();
  
  const { data: rows } = await supabase
    .from('odds_snapshots')
    .select('event_label')
    .gte('recorded_at', cutoffIso)
    .limit(5000); // just checking the first 5000 to extract dates

  if (!rows) return;

  const dates = new Set();
  for (const row of rows) {
    const parts = row.event_label.split(' | ');
    if (parts[1]) {
      dates.add(parts[1]);
    }
  }

  const sortedDates = Array.from(dates).sort();
  console.log('Earliest matches:');
  sortedDates.slice(0, 5).forEach(d => console.log(d));

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const within24h = sortedDates.filter((d: any) => new Date(d) <= next24h && new Date(d) >= now);
  console.log(`Matches within 24h: ${within24h.length}`);
}
checkDates();
