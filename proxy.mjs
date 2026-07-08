import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = 8080;
const ROOT = import.meta.dirname;
const MIME = {
  '.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp',
  '.mp4':'video/mp4','.svg':'image/svg+xml','.ico':'image/x-icon',
};

const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function fetchWithTimeout(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': ua } }).finally(() => clearTimeout(t));
}

function detectPlatform(url) {
  const p = [/v\.douyin\.com/i,/douyin\.com\/video/i,/iesdouyin/i,/xhslink\.com/i,/xiaohongshu\.com/i,/kuaishou\.com/i,/weibo\.com/i];
  const n = ['douyin','douyin','douyin','xiaohongshu','xiaohongshu','kuaishou','weibo'];
  for (let i=0;i<p.length;i++) if (p[i].test(url)) return n[i];
  if (url.includes('douyin')||url.includes('抖音')) return 'douyin';
  if (url.includes('xhslink')||url.includes('xiaohongshu')||url.includes('小红书')) return 'xiaohongshu';
  return 'unknown';
}

async function parseDouyin(shareUrl) {
  // Step 1: Resolve short URL → get iesdouyin page
  let resolvedUrl = shareUrl;
  try {
    const r = await fetch(shareUrl, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get('location');
    if (loc) resolvedUrl = loc.startsWith('http') ? loc : new URL(loc, shareUrl).href;
  } catch {}

  const awemeId = resolvedUrl.match(/video\/(\d+)/)?.[1] || shareUrl.match(/video\/(\d+)/)?.[1] || '';

  // Step 2: Fetch the page HTML to get video_id and metadata
  let html = '';
  try {
    const r = await fetchWithTimeout(resolvedUrl);
    html = await r.text();
  } catch {}

  if (!html) return null;

  // Extract video_id from playwm URL or similar patterns
  const videoIdMatch = html.match(/video_id=([a-z0-9_]+)/) || html.match(/"video_id"\s*:\s*"([^"]+)"/) || html.match(/video_id%3D([a-z0-9_]+)/);
  const videoId = videoIdMatch?.[1] || '';

  if (!videoId) return null;

  // Step 3: Use snssdk.com play URL (will be resolved through proxy during download)
  const videoUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;

  // Step 4: Extract metadata from HTML
  let title = '', author = '', cover = '';
  try {
    const unesc = s => s?.replace(/\\u002F/g, '/').replace(/\\n/g, ' ').replace(/\\"/g, '"') || '';
    const d = html.match(/"desc"\s*:\s*"([^"]+)"/);
    if (d) title = unesc(d[1]);
    const n = html.match(/"nickname"\s*:\s*"([^"]+)"/);
    if (n) author = unesc(n[1]);
    const c = html.match(/"cover"[^}]+"url_list"\s*:\s*\["([^"]+)"/);
    if (c) cover = c[1].replace(/\\u002F/g, '/');
    if (!cover) {
      const cm = html.match(/https?:\/\/p3-sign\.douyinpic\.com[^"'\s]+?\.(?:webp|jpe?g|png)/);
      if (cm) cover = cm[0];
    }
  } catch {}

  return {
    type: 'video',
    title, author,
    videoUrl,
    cover,
    images: [],
    platform: 'douyin',
    awemeId,
  };
}

async function parseXiaohongshu(url) {
  let resolvedUrl = url;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get('location');
    if (loc) resolvedUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
  } catch {}

  const noteId = resolvedUrl.match(/explore\/([a-f0-9]+)/)?.[1];
  if (!noteId) return null;

  const apiUrl = `https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=${noteId}`;
  try {
    const r = await fetchWithTimeout(apiUrl);
    if (r.ok) {
      const j = await r.json();
      const d = j?.data?.items?.[0]?.note_card;
      if (d) {
        return {
          type: d.type === 'video' ? 'video' : 'image',
          title: d.title || d.desc || '',
          author: d.user?.nickname || '',
          videoUrl: d.video?.media?.stream?.h264?.[0]?.master_url || '',
          cover: d.cover?.url || (d.imageList?.[0]?.urlDefault) || '',
          images: (d.imageList || []).map(i => i.urlDefault || i.url || '').filter(Boolean),
          platform: 'xiaohongshu',
        };
      }
    }
  } catch {}

  // Fallback: third-party APIs
  const fallbackUrl = `https://api.52vmy.cn/api/wl/shipin?url=${encodeURIComponent(url)}&type=json`;
  try {
    const r = await fetchWithTimeout(fallbackUrl);
    const j = await r.json();
    if (j.code === 200 && j.data) {
      return {
        type: j.data.images?.length ? 'image' : 'video',
        title: j.data.title || '',
        author: j.data.author || '',
        videoUrl: j.data.video || '',
        images: (j.data.images || []).filter(Boolean),
        cover: j.data.cover || '',
        platform: 'xiaohongshu',
      };
    }
  } catch {}

  return null;
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

async function handleAPI(req, res, urlObj) {
  const link = urlObj.searchParams.get('url');
  if (!link) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Missing url parameter' }));
    return;
  }

  const platform = detectPlatform(link);
  let result = null;

  try {
    if (platform === 'douyin') result = await parseDouyin(link);
    else if (platform === 'xiaohongshu') result = await parseXiaohongshu(link);
    else {
      // Try both parsers
      result = await parseDouyin(link) || await parseXiaohongshu(link);
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
    return;
  }

  if (result) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 200, data: result }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 404, error: '解析失败' }));
  }
}

async function handleProxyDownload(req, res, urlObj) {
  const targetUrl = urlObj.searchParams.get('url');
  if (!targetUrl || !targetUrl.startsWith('http')) {
    res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
    res.end('Bad Request');
    return;
  }

  try {
    // First try: buffer and relay (for browsers that don't allow direct CDN access)
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': ua,
        'Referer': 'https://www.douyin.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) throw new Error('CDN returned ' + resp.status);

    const contentType = resp.headers.get('content-type') || 'video/mp4';
    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    };
    if (contentType.startsWith('video/')) {
      headers['Content-Disposition'] = 'attachment; filename="douyin_video.mp4"';
    }

    // Buffer the entire response
    const buffer = Buffer.from(await resp.arrayBuffer());
    headers['Content-Length'] = buffer.length;
    res.writeHead(200, headers);
    res.end(buffer);
  } catch (e) {
    // Second try: redirect the browser to the CDN URL
    try {
      const resp2 = await fetch(targetUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': ua, 'Referer': 'https://www.douyin.com/' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000)
      });
      const redirectUrl = resp2.headers.get('location');
      if (redirectUrl) {
        res.writeHead(302, { 'Location': redirectUrl, 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
    } catch {}
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: '代理下载失败: ' + e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress;

  // CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // API endpoint
  if (url.pathname === '/api/parse') {
    await handleAPI(req, res, url);
    return;
  }

  // Proxy download endpoint
  if (url.pathname === '/api/proxy') {
    await handleProxyDownload(req, res, url);
    return;
  }

  // Static files
  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  serveFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🧹 去水印工具 已启动
  ─────────────────────────
  http://localhost:${PORT}
  http://本机IP:${PORT}  (手机在同一Wi-Fi下访问)

  手机操作步骤:
  1. 手机连接同一个Wi-Fi
  2. 浏览器访问上面的地址
  3. 粘贴分享链接 → 自动解析下载

  按 Ctrl+C 停止服务
  `);
});
