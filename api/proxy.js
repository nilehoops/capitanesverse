export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });

  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (target.hostname !== 'stats.nba.com') return res.status(403).json({ error: 'Only stats.nba.com allowed' });

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'User-Agent':          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':             'https://www.nba.com/',
        'Accept':              'application/json, text/plain, */*',
        'Accept-Language':     'en-US,en;q=0.9',
        'Origin':              'https://www.nba.com',
        'x-nba-stats-origin':  'stats',
        'x-nba-stats-token':   'true',
      },
    });
    const data = await response.json();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
