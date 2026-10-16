import { getActiveSports, getUpcomingMatches } from './lib/apis/odds-api';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const sports = getActiveSports();
  console.log('Active sports:', sports);

  const matches = await getUpcomingMatches('upcoming');
  console.log(`Fetched ${matches.length} matches in total.`);

  const sportCounts: Record<string, number> = {};
  matches.forEach(m => {
    sportCounts[m.sport_key] = (sportCounts[m.sport_key] || 0) + 1;
  });
  console.log('Matches per sport:', sportCounts);
}

test();
