import { getActiveSports, getUpcomingMatches } from './lib/apis/odds-api';
import { getSmartPicks, isOddsAcceptable } from './lib/algorithms/value-bet-calculator';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const matches = await getUpcomingMatches('upcoming');
  const mlsMatches = matches.filter(m => m.sport_key === 'soccer_usa_mls');
  console.log(`\nTotal MLS matches from API: ${mlsMatches.length}`);
  
  // What does getSmartPicks return?
  const smartPicks = getSmartPicks(mlsMatches, true);
  console.log(`Total MLS Smart Picks (after filtering): ${smartPicks.length}`);
}

test();
