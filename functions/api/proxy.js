const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S9080) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const ua = UAS[0];
    const resp = await fetch(target, {
      headers: {
        'User-Agent': ua,
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Download failed', status: resp.status }), {
        status: resp.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const contentLength = resp.headers.get('content-length');

    const responseHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    };
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    return new Response(resp.body, { headers: responseHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
