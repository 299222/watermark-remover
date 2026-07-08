const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(204).end('');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const result = await parse(url);
    if (result) return res.json({ code: 200, data: result });
    return res.json({ code: 404, error: '解析失败' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function parse(shareUrl) {
  const platform = detect(shareUrl);
  if (platform === 'douyin') return parseDouyin(shareUrl);
  if (platform === 'xiaohongshu') return parseXiaohongshu(shareUrl);
  return parseDouyin(shareUrl) || parseXiaohongshu(shareUrl);
}

function detect(url) {
  if (/v\.douyin\.com|douyin\.com\/video|iesdouyin/i.test(url) || url.includes('douyin') || url.includes('抖音')) return 'douyin';
  if (/xhslink\.com|xiaohongshu\.com/i.test(url) || url.includes('小红书')) return 'xiaohongshu';
  return 'unknown';
}

async function fetchHTML(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': ua }, signal: ctrl.signal });
    return { ok: resp.ok, text: await resp.text(), headers: resp.headers };
  } finally { clearTimeout(t); }
}

async function parseDouyin(shareUrl) {
  let resolved = shareUrl;
  try {
    const r = await fetch(shareUrl, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (loc) resolved = loc.startsWith('http') ? loc : new URL(loc, shareUrl).href;
  } catch {}

  const page = await fetchHTML(resolved);
  if (!page.ok) return null;
  const html = page.text;

  const vidMatch = html.match(/video_id=([a-z0-9_]+)/) || html.match(/"video_id"\s*:\s*"([^"]+)"/);
  const videoId = vidMatch?.[1];
  if (!videoId) return null;

  const unesc = s => s?.replace(/\\u002F/g, '/').replace(/\\n/g, ' ').replace(/\\"/g, '"') || '';
  const title = unesc(html.match(/"desc"\s*:\s*"([^"]+)"/)?.[1]);
  const author = unesc(html.match(/"nickname"\s*:\s*"([^"]+)"/)?.[1]);
  const coverMatch = html.match(/"cover"[^}]+"url_list"\s*:\s*\["([^"]+)"/);
  let cover = coverMatch?.[1]?.replace(/\\u002F/g, '/') || '';
  if (!cover) {
    const cm = html.match(/https?:\/\/p3-sign\.douyinpic\.com[^"'<>]+?\.(?:webp|jpe?g|png)/);
    if (cm) cover = cm[0];
  }

  return {
    type: 'video',
    title, author, cover,
    videoUrl: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`,
    images: [], platform: 'douyin',
  };
}

async function parseXiaohongshu(url) {
  let resolved = url;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (loc) resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
  } catch {}

  const noteId = resolved.match(/explore\/([a-f0-9]+)/)?.[1];
  if (!noteId) return null;

  try {
    const r = await fetch(`https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=${noteId}`, {
      headers: { 'User-Agent': ua, 'Referer': 'https://www.xiaohongshu.com/' },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data?.items?.[0]?.note_card;
    if (!d) return null;
    return {
      type: d.type === 'video' ? 'video' : 'image',
      title: d.title || d.desc || '',
      author: d.user?.nickname || '',
      videoUrl: d.video?.media?.stream?.h264?.[0]?.master_url || '',
      cover: d.cover?.url || d.imageList?.[0]?.urlDefault || '',
      images: (d.imageList || []).map(i => i.urlDefault || i.url || '').filter(Boolean),
      platform: 'xiaohongshu',
    };
  } catch {
    try {
      const r = await fetch(`https://api.52vmy.cn/api/wl/shipin?url=${encodeURIComponent(url)}&type=json`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j = await r.json();
      if (j.code !== 200 || !j.data) return null;
      return {
        type: j.data.images?.length ? 'image' : 'video',
        title: j.data.title || '',
        author: j.data.author || '',
        videoUrl: j.data.video || '',
        images: (j.data.images || []).filter(Boolean),
        cover: j.data.cover || '',
        platform: 'xiaohongshu',
      };
    } catch { return null; }
  }
}
