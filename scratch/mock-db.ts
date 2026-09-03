import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const futureDate = new Date();
  futureDate.setHours(futureDate.getHours() + 10);
  const nowIso = new Date().toISOString();

  const match1 = {
    event_id: 'mock_match_1',
    event_label: `Mock Team A vs Mock Team B | ${futureDate.toISOString()}`,
    sport_key: 'soccer_usa_mls',
    bookmaker_key: 'pinnacle',
    market_key: 'h2h',
    outcome_name: 'Mock Team A',
    odds: 2.15,
    recorded_at: nowIso,
  };
  const match1_b2 = { ...match1, bookmaker_key: 'bet365', odds: 1.95 };
  
  futureDate.setHours(futureDate.getHours() + 20);
  const match2 = {
    event_id: 'mock_match_2',
    event_label: `Mock Team C vs Mock Team D | ${futureDate.toISOString()}`,
    sport_key: 'soccer_epl',
    bookmaker_key: 'pinnacle',
    market_key: 'h2h',
    outcome_name: 'Mock Team C',
    odds: 3.50,
    recorded_at: nowIso,
  };
  const match2_b2 = { ...match2, bookmaker_key: 'bet365', odds: 3.10 };

  console.log('Inserting mock data...');
  const { error } = await supabase.from('odds_snapshots').insert([match1, match1_b2, match2, match2_b2]);
  if (error) console.error(error);
  else console.log('Successfully inserted mock data!');
}
run();
