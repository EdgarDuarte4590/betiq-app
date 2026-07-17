import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.error('No RAPIDAPI_KEY found');
    return;
  }

  const url = 'https://sofascore.p.rapidapi.com/teams/search?name=Real%20Madrid';
  const options = {
    method: 'GET',
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': 'sofascore.p.rapidapi.com'
    }
  };

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    console.log(result);
  } catch (error) {
    console.error(error);
  }
}

test();
