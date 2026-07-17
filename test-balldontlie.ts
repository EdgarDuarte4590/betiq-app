import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    console.error('No BALLDONTLIE_API_KEY found');
    return;
  }

  const url = 'https://api.balldontlie.io/v1/teams';
  const options = {
    method: 'GET',
    headers: {
      'Authorization': apiKey
    }
  };

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    console.log('BallDontLie response status:', response.status);
    console.log(result.data ? result.data.slice(0, 2) : result);
  } catch (error) {
    console.error(error);
  }
}

test();
