import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
async function test() {
  const API_KEY = process.env.THE_ODDS_API_KEY;
  if (!API_KEY) { console.log('No API KEY'); return; }
  const url = `https://api.the-odds-api.com/v4/sports/upcoming/odds?apiKey=${API_KEY}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;
  const res = await fetch(url);
  console.log('Status:', res.status, res.statusText);
  console.log('Requests Remaining:', res.headers.get('x-requests-remaining'));
  console.log('Requests Used:', res.headers.get('x-requests-used'));
  if (!res.ok) {
    const text = await res.text();
    console.log('Body:', text);
  } else {
    console.log('OK, fetched events');
  }
}
test();
