/**
 * DesigniDL — Render.com Proxy Server v2.0
 * ─────────────────────────────────────────
 * Fetches the real file from a Designi page URL, wraps it in a ZIP,
 * and streams it back to the browser with correct headers.
 *
 * Deploy: connect GitHub repo Rafid31/designidl to Render.com
 *   Build:  npm install
 *   Start:  node server.mjs
 *
 * Endpoint: GET /proxy?url=<encoded-designi-url>
 */

import express from 'express';
import JSZip   from 'jszip';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  res.header('Access-Control-Expose-Headers','Content-Disposition, Content-Type, X-Filename');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── BROWSER-LIKE HEADERS ─────────────────────────────────────────
const UA = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
};

// ── MIME → EXTENSION ─────────────────────────────────────────────
const MIME_EXT = {
  'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp',
  'image/svg+xml':'svg','application/pdf':'pdf',
  'application/zip':'zip','application/x-zip-compressed':'zip',
  'application/x-rar-compressed':'rar','application/vnd.rar':'rar',
  'video/mp4':'mp4','video/quicktime':'mov',
  'application/postscript':'eps','application/illustrator':'ai',
  'image/vnd.adobe.photoshop':'psd','application/x-photoshop':'psd',
  'application/octet-stream':'psd',
};
const mimeToExt = ct => MIME_EXT[(ct||'').toLowerCase().split(';')[0].trim()] || 'file';

// ── FILENAME FROM HEADERS ─────────────────────────────────────────
function extractFilename(headers, fallback) {
  const cd = headers.get('content-disposition') || '';
  const rfc = cd.match(/filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i);
  if (rfc) return decodeURIComponent(rfc[1]);
  const plain = cd.match(/filename=["']?([^"';\r\n]+)["']?/i);
  if (plain) return plain[1].trim().replace(/^["']|["']$/g,'');
  return fallback || 'designi_file';
}

// ── SCRAPE HTML FOR REAL DOWNLOAD URL ────────────────────────────
function findRealUrl(html, pageUrl) {
  const base = new URL(pageUrl);

  // A: CDN/storage URL with known file extension
  const cdnRe = /["'`](https?:\/\/[^"'`\s]+?\.(?:psd|png|jpg|jpeg|svg|ai|eps|zip|rar|pdf|mp4|mov|gif|webp)(?:[?#][^"'`\s]*)?)["'`]/gi;
  let m;
  while ((m = cdnRe.exec(html)) !== null) {
    if (/cdn\.|s3\.|storage\.|media\.|files\.|download\.|assets\./.test(m[1])) return m[1];
  }
  // Second pass — any URL with file extension
  const anyRe = /["'`](https?:\/\/[^"'`\s]+?\.(?:psd|png|jpg|jpeg|svg|ai|eps|zip|rar|pdf|mp4|mov|gif|webp)(?:[?#][^"'`\s]*)?)["'`]/gi;
  m = anyRe.exec(html);
  if (m) return m[1];

  // B: data-url / data-download / data-file attributes
  const dataRe = /data-(?:url|download|file|src|href)=["']([^"']+)["']/gi;
  while ((m = dataRe.exec(html)) !== null) {
    if (/\.(?:psd|png|jpg|jpeg|svg|ai|eps|zip|rar|pdf|mp4|mov|gif|webp)/i.test(m[1]))
      return m[1].startsWith('http') ? m[1] : base.origin + (m[1].startsWith('/')?'':'/') + m[1];
  }

  // C: JSON "url" / "download_url" fields
  const jsonRe = /"(?:url|download_url|file_url|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  while ((m = jsonRe.exec(html)) !== null) {
    if (/\.(?:psd|png|jpg|jpeg|svg|ai|eps|zip|rar|pdf|mp4|mov|gif|webp)/i.test(m[1])) return m[1];
  }

  // D: href with file extension
  const hrefRe = /href=["']([^"']+\.(?:psd|png|jpg|jpeg|svg|ai|eps|zip|rar|pdf|mp4|mov|gif|webp)[^"']*)["']/gi;
  m = hrefRe.exec(html);
  if (m) return m[1].startsWith('http') ? m[1] : base.origin + m[1];

  return null;
}

// ── WRAP BUFFER IN ZIP AND RESPOND ───────────────────────────────
async function respondZip(res, buffer, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._\-()\s]/g,'_').replace(/\s+/g,'_');
  // Already a ZIP? (PK magic bytes 50 4B)
  const b = new Uint8Array(buffer);
  if (b[0]===0x50 && b[1]===0x4B) {
    const zn = safe.endsWith('.zip') ? safe : safe.replace(/\.[^.]+$/,'.zip');
    res.header('Content-Type','application/zip');
    res.header('Content-Disposition',`attachment; filename="${zn}"`);
    res.header('X-Filename', zn);
    return res.send(Buffer.from(buffer));
  }
  const zip = new JSZip();
  zip.file(safe, buffer);
  const out = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{level:6} });
  const zn  = safe.replace(/\.[^.]+$/,'.zip');
  res.header('Content-Type','application/zip');
  res.header('Content-Disposition',`attachment; filename="${zn}"`);
  res.header('X-Filename', zn);
  return res.send(out);
}

// ── MAIN PROXY ENDPOINT ──────────────────────────────────────────
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error:'Missing ?url= parameter' });

  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return res.status(400).json({ error:'Invalid URL' }); }
  if (!['http:','https:'].includes(parsed.protocol))
    return res.status(400).json({ error:'Only HTTP/HTTPS allowed' });

  const opts = (extra={}) => ({
    headers: { ...UA, Accept:'*/*', Referer:'https://www.designi.com.br/', ...extra },
    redirect:'follow',
  });

  try {
    // ── Round 1: Fetch URL directly — may already be a binary file ──
    const r1  = await fetch(targetUrl, opts());
    const ct1 = (r1.headers.get('content-type')||'').toLowerCase();

    if (r1.ok && !ct1.includes('text/html') && !ct1.includes('text/plain')) {
      const buf  = await r1.arrayBuffer();
      const ext  = mimeToExt(ct1);
      const name = extractFilename(r1.headers, `designi_file.${ext}`);
      return respondZip(res, buf, name);
    }

    // ── Round 2: Got HTML — scrape for real download link ───────
    if (ct1.includes('text/html')) {
      const html   = await r1.text();
      const realUrl = findRealUrl(html, targetUrl);
      if (realUrl && realUrl !== targetUrl) {
        const r2  = await fetch(realUrl, opts());
        const ct2 = (r2.headers.get('content-type')||'').toLowerCase();
        if (r2.ok && !ct2.includes('text/html')) {
          const buf  = await r2.arrayBuffer();
          const ext  = mimeToExt(ct2);
          const name = extractFilename(r2.headers, `designi_file.${ext}`);
          return respondZip(res, buf, name);
        }
      }
    }

    // ── Round 3: Try Designi-specific endpoint patterns ──────────
    const slug = parsed.pathname.replace(/^\/+|\/+$/g,'');
    for (const u of [
      `${parsed.origin}/download/${slug}`,
      `${parsed.origin}/baixar/${slug}`,
      `${parsed.origin}/file/${slug}`,
      `${parsed.origin}/api/download/${slug}`,
    ]) {
      try {
        const r  = await fetch(u, opts());
        const ct = (r.headers.get('content-type')||'').toLowerCase();
        if (r.ok && !ct.includes('text/html')) {
          const buf  = await r.arrayBuffer();
          const ext  = mimeToExt(ct);
          const name = extractFilename(r.headers, `designi_file.${ext}`);
          return respondZip(res, buf, name);
        }
      } catch { /* try next */ }
    }

    return res.status(404).json({
      error:'No downloadable file found at this URL.',
      hint:'The Designi page may require authentication or the link has expired.',
    });
  } catch (err) {
    console.error('[proxy]', err.message);
    return res.status(502).json({ error:'Proxy error: '+err.message });
  }
});

// ── SERVE FRONTEND STATIC FILES ──────────────────────────────────
// index.html  → https://designidl-proxy.onrender.com/
// admin-panel → https://designidl-proxy.onrender.com/admin-panel.html
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(__dirname));               // serves all .html files
app.get('/', (_,res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/health', (_,res) => res.json({ status:'ok', service:'designidl-proxy', v:'2.0' }));

app.listen(PORT, () => console.log(`[DesigniDL Proxy] Listening on port ${PORT}`));
