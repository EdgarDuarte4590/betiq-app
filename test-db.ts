import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getDashboardData } from './lib/data/dashboard-data';
import { extractValueBets, getSmartPicks } from './lib/algorithms/value-bet-calculator';
import { categorizeEventsByTime } from './lib/apis/odds-api';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function test() {
  const { data: latestRow } = await supabase
    .from('odds_snapshots')
    .select('recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) {
    console.log('NO SNAPSHOTS IN DB');
    return;
  }

  console.log(`Latest snapshot: ${latestRow.recorded_at}`);
  
  const cutoffTime = new Date(latestRow.recorded_at);
  cutoffTime.setMinutes(cutoffTime.getMinutes() - 30);

  const { data: rows, error } = await supabase
    .from('odds_snapshots')
    .select('*')
    .gte('recorded_at', cutoffTime.toISOString())
    .order('recorded_at', { ascending: false })
    .limit(50000);

  console.log(`Total rows fetched within 30 min of latest: ${rows?.length}, Error: ${error}`);
}
test();
