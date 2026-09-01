const API_KEY = process.env.HENRIK_API_KEY;

async function henrik(path) {
  if (!API_KEY) {
    throw new Error('HENRIK_API_KEY is missing');
  }

  const res = await fetch(`https://api.henrikdev.xyz${path}`, {
    headers: {
      Authorization: API_KEY
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message || `HenrikDev error ${res.status}`);
  }

  return data;
}

module.exports = { henrik };