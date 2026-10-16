import { getActiveSports, getUpcomingMatches } from './lib/apis/odds-api';
import { getSmartPicks } from './lib/algorithms/value-bet-calculator';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const matches = await getUpcomingMatches('upcoming');
  const smartPicks = getSmartPicks(matches, true);
  
  const mlsPicks = smartPicks.filter(p => p.sport === 'soccer_usa_mls');
  console.log(`\nFound ${mlsPicks.length} acceptable picks for MLS:`);
  mlsPicks.forEach(p => {
    console.log(`- ${p.event} | ${p.bestPick} | Odds: ${p.bestOdds} | Value: ${p.valuePercentage.toFixed(1)}% | Zone: ${p.bestOdds <= 1.95 ? 'A' : p.bestOdds <= 2.50 ? 'B' : 'C'}`);
  });
}

test();
