export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'Download failed' });
    }

    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const contentLength = resp.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    res.flushHeaders();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
