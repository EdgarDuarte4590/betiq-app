import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getDashboardData } from './lib/data/dashboard-data';
import * as supabaseServer from './lib/supabase/server';
import { createClient as createClientBrowser } from '@supabase/supabase-js';

// Mock createClient
// @ts-ignore
supabaseServer.createClient = async () => {
  return createClientBrowser(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
};

async function test() {
  console.log('Fetching dashboard data...');
  const events = await getDashboardData();
  console.log(`Returned ${events.length} events from reconstructOddEvents`);
  if (events.length > 0) {
    console.log(`First event: ${events[0].home_team} vs ${events[0].away_team} - Bookmakers: ${events[0].bookmakers.length}`);
  }
}
test();
