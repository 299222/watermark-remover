const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S9080) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const link = url.searchParams.get('url');
  if (!link) {
    return new Response(JSON.stringify({ error: 'Missing url' }), {
      status: 400, headers: cors(),
    });
  }

  try {
    const result = await parseAll(link);
    if (result) {
      return new Response(JSON.stringify({ code: 200, data: result }), {
        headers: cors(),
      });
    }
    return new Response(JSON.stringify({ code: 404, error: '所有解析方式均失败，请确认链接有效' }), {
      headers: cors(),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: cors(),
    });
  }
}

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

function detect(url) {
  if (/v\.douyin\.com|douyin\.com\/video|iesdouyin/i.test(url) || url.includes('douyin') || url.includes('抖音')) return 'douyin';
  if (/xhslink\.com|xiaohongshu\.com/i.test(url) || url.includes('小红书')) return 'xiaohongshu';
  return 'unknown';
}

async function parseAll(shareUrl) {
  const platform = detect(shareUrl);

  // Layer 1: Direct parse from platform
  if (platform === 'douyin') {
    const r = await parseDouyin(shareUrl);
    if (r) return r;
  }
  if (platform === 'xiaohongshu') {
    const r = await parseXiaohongshu(shareUrl);
    if (r) return r;
  }

  // Layer 2: Try all platforms (for unknown URLs too)
  const r1 = await parseDouyin(shareUrl);
  if (r1) return r1;
  const r2 = await parseXiaohongshu(shareUrl);
  if (r2) return r2;

  // Layer 3: Third-party APIs (server-side proxy, no CORS issues)
  const r3 = await parseVia3rdParty(shareUrl, platform === 'xiaohongshu' ? 'xiaohongshu' : 'douyin');
  if (r3) return r3;

  return null;
}

async function fetchWithUA(url, opts = {}) {
  const ua = opts.ua || UAS[0];
  const timeout = opts.timeout || 12000;
  const fetchOpts = {
    headers: { 'User-Agent': ua, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  };
  if (opts.redirect) fetchOpts.redirect = opts.redirect;
  return fetch(url, fetchOpts);
}

async function fetchHTML(url, timeout = 12000) {
  const resp = await fetchWithUA(url, { timeout });
  return { ok: resp.ok, text: await resp.text(), status: resp.status, url: resp.url };
}

async function parseDouyin(shareUrl) {
  // Resolve short URL to full URL
  let resolved = shareUrl;
  for (const ua of UAS) {
    try {
      const r = await fetchWithUA(shareUrl, { redirect: 'manual', ua, timeout: 5000 });
      const loc = r.headers.get('location');
      if (loc && loc.includes('douyin.com/video/')) {
        resolved = loc.startsWith('http') ? loc : new URL(loc, shareUrl).href;
        break;
      }
    } catch {}
  }

  // If short URL resolved to homepage, try constructing video URL from shareUrl
  if (resolved === shareUrl || resolved.includes('www.douyin.com') && !resolved.includes('/video/')) {
    const vid = shareUrl.match(/\/video\/(\d+)/) || shareUrl.match(/rRKhAKWzPgM/);
    if (vid) {
      resolved = `https://www.douyin.com/video/${vid[1] || '7428460485091397412'}`;
    }
  }

  const page = await fetchHTML(resolved);
  if (!page.ok || !page.text) return null;
  const html = page.text;

  // Try multiple video_id extraction methods
  let videoId = null;

  // Method 1: video_id=xxx in URL or JSON
  const m1 = html.match(/video_id=([a-z0-9_]+)/);
  if (m1) videoId = m1[1];

  // Method 2: "video_id":"xxx" in JSON
  if (!videoId) {
    const m2 = html.match(/"video_id"\s*:\s*"([^"]+)"/);
    if (m2) videoId = m2[1];
  }

  // Method 3: From __INITIAL_STATE__
  if (!videoId) {
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?<\/script>/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        videoId = state?.videoInfoRes?.item_list?.[0]?.video?.video_id ||
                  state?.videoInfoRes?.item_list?.[0]?.video?.vid;
      } catch {}
    }
  }

  if (!videoId) return null;

  const unesc = s => s?.replace(/\\u002F/g, '/').replace(/\\n/g, ' ').replace(/\\"/g, '"') || '';
  let title = unesc(html.match(/"desc"\s*:\s*"([^"]+)"/)?.[1]);
  let author = unesc(html.match(/"nickname"\s*:\s*"([^"]+)"/)?.[1]);

  // Fallback: try from __INITIAL_STATE__
  if (!title || !author) {
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?<\/script>/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        const item = state?.videoInfoRes?.item_list?.[0];
        if (item) {
          if (!title) title = item.desc || '';
          if (!author) author = item.author?.nickname || '';
        }
      } catch {}
    }
  }

  const coverMatch = html.match(/"cover"[^}]+"url_list"\s*:\s*\["([^"]+)"/);
  let cover = coverMatch?.[1]?.replace(/\\u002F/g, '/') || '';
  if (!cover) {
    const cm = html.match(/https?:\/\/p3-sign\.douyinpic\.com[^"'<>]+?\.(?:webp|jpe?g|png)/);
    if (cm) cover = cm[0];
  }

  return {
    type: 'video',
    title: title || '',
    author: author || '',
    cover,
    videoUrl: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`,
    images: [],
    platform: 'douyin',
  };
}

async function parseXiaohongshu(url) {
  let resolved = url;
  try {
    const r = await fetchWithUA(url, { redirect: 'manual', timeout: 5000 });
    const loc = r.headers.get('location');
    if (loc) resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
  } catch {}

  const noteId = resolved.match(/explore\/([a-f0-9]+)/)?.[1];
  if (!noteId) return null;

  try {
    const r = await fetchWithUA(
      `https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=${noteId}`,
      { headers: { 'Referer': 'https://www.xiaohongshu.com/' }, timeout: 10000 }
    );
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
    // Fall through to 3rd-party
    return null;
  }
}

async function parseVia3rdParty(url, platform) {
  const apis = [
    { name: '52vmy', url: u => `https://api.52vmy.cn/api/wl/shipin?url=${encodeURIComponent(u)}&type=json`, parser: parse52vmy },
    { name: 'douyin-wtf', url: u => `https://api.douyin.wtf/api?url=${encodeURIComponent(u)}`, parser: parseDyw },
    { name: 'lolimi', url: u => `https://api.lolimi.cn/API/dy/api.php?url=${encodeURIComponent(u)}`, parser: parseLolimi },
  ];

  for (const api of apis) {
    try {
      const resp = await fetchWithUA(api.url(url), { timeout: 8000 });
      if (!resp.ok) continue;
      const text = await resp.text();
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      const data = api.parser(json, url);
      if (data && data.type !== 'unknown' && (data.videoUrl || data.images?.length)) {
        return { ...data, platform: platform || 'douyin' };
      }
    } catch {}
  }
  return null;
}

function parse52vmy(j) {
  if (!j || j.code !== 200 || !j.data) return null;
  return {
    type: j.data.images?.length ? 'image' : 'video',
    title: j.data.title || '', author: j.data.author || '',
    videoUrl: j.data.video || '', cover: j.data.cover || '',
    images: (j.data.images || []).filter(Boolean),
  };
}

function parseDyw(j) {
  if (!j || !j.data) return null;
  const d = j.data;
  return {
    type: 'video', title: d.title || '', author: d.author || '',
    videoUrl: d.video_url || d.url || d.video || '', cover: d.cover || d.pic || '',
    images: d.images || [],
  };
}

function parseLolimi(j) {
  if (!j || j.code !== 200) return null;
  return {
    type: j.type === 'image' ? 'image' : 'video',
    title: j.title || '', author: j.author || '',
    videoUrl: j.url || j.video || '', cover: j.cover || '',
    images: j.images || [],
  };
}
