const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
(async () => {
  const url = 'https://v.douyin.com/qfvpq0g-2Wg/';
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) });
    console.log('Status:', r.status);
    const loc = r.headers.get('location');
    console.log('Location:', loc);
    
    if (loc && loc.includes('douyin.com/video/')) {
      const p = await fetch(loc, { headers: { 'User-Agent': ua } });
      const html = await p.text();
      console.log('Final URL:', p.url);
      console.log('HTML length:', html.length);
      const m = html.match(/video_id=([a-z0-9_]+)/) || html.match(/"video_id"\s*:\s*"([^"]+)"/);
      console.log('Video ID:', m ? m[1] : 'not found');
    } else if (loc) {
      const p = await fetch(loc, { headers: { 'User-Agent': ua } });
      const html = await p.text();
      console.log('Redirected to:', p.url);
      console.log('HTML length:', html.length);
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
})();
