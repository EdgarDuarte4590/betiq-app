import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const apiKey = '81477caa6amsh424b7f531bc04c6p1ebe59jsn19af5ba33e34'; 
  const host = 'sofascore6.p.rapidapi.com';

  const teamId = 2829;
  const url = `https://${host}/api/sofascore/v1/team/matches/finished?team_id=${teamId}`;
  
  try {
    const response = await fetch(url, {
      headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host }
    });
    console.log(`Testing ${url}... Status: ${response.status}`);
    const result = await response.json();
    console.log(result.events ? `Got ${result.events.length} events` : result);
    
    // Print winner of first event to see structure
    if (result.events && result.events.length > 0) {
      const e = result.events[0];
      console.log(`${e.homeTeam.name} ${e.homeScore?.display} - ${e.awayScore?.display} ${e.awayTeam.name}`);
      console.log('Winner code:', e.winnerCode); // 1 = home, 2 = away, 3 = draw
    }
  } catch (error) {
    console.error(error);
  }
}

test();
