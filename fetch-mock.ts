import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local' });
async function run() {
  const API_KEY = process.env.THE_ODDS_API_KEY;
  if (!API_KEY) { console.log('No API KEY'); return; }
  const sports = [
    'soccer_epl',
    'soccer_spain_la_liga',
    'soccer_uefa_champs_league',
    'soccer_france_ligue_one',
    'soccer_italy_serie_a',
    'soccer_germany_bundesliga',
    'basketball_nba',
    'baseball_mlb',
  ];
  try {
    const fetchPromises = sports.map(async (s) => {
      const url = `https://api.the-odds-api.com/v4/sports/${s}/odds?apiKey=${API_KEY}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;
      const response = await fetch(url);
      if (!response.ok) {
        console.log('Failed:', await response.text());
        return [];
      }
      return await response.json();
    });
    const results = await Promise.all(fetchPromises);
    const allEvents = results.flat();
    fs.writeFileSync('lib/apis/odds-mock.json', JSON.stringify(allEvents, null, 2));
    console.log('Saved', allEvents.length, 'events to odds-mock.json');
  } catch (err) {
    console.error(err);
  }
}
run();
