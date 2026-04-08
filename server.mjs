/**
 * DesigniDL — Render.com Proxy Server v3.0
 * ─────────────────────────────────────────
 * Uses Designi's real API (Supabase + Meilisearch) to download
 * the actual file and return it as a ZIP archive.
 *
 * Env vars required (set in Render → Environment):
 *   DESIGNI_TOKEN  — your Designi session JWT
 *                    Get it: log into designi.com.br → DevTools
 *                    → Application → Local Storage → designi_session_token
 *
 * Endpoints:
 *   GET /proxy?url=https://www.designi.com.br/<hash>
 *   GET /health
 *   GET /  → serves index.html
 */

import express from 'express';
import JSZip   from 'jszip';
import path    from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Load persisted token from disk (survives redeploys on Render Disk) ──
const TOKEN_FILE = path.join(__dirname, '.designi_token');
try {
  if (!process.env.DESIGNI_TOKEN && existsSync(TOKEN_FILE)) {
    process.env.DESIGNI_TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
    console.log('Loaded DESIGNI_TOKEN from disk.');
  }
} catch(e) { console.warn('Could not read token file:', e.message); }

// ── Designi / Supabase constants (public, from the app bundle) ────
const SUPABASE_URL  = 'https://soueuzuauddqhuojssek.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdWV1enVhdWRkcWh1b2pzc2VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MzcwODAsImV4cCI6MjA4MjAxMzA4MH0.rrT9f6Y0igImXG-lQq72I7zwaOvHxCtCNtW6XkOyEAU';

// ── CORS ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-DT');
  res.header('Access-Control-Expose-Headers','Content-Disposition, X-Filename, X-Error');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── BROWSER HEADERS ───────────────────────────────────────────────
const UA = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ── CALL SUPABASE EDGE FUNCTION ───────────────────────────────────
async function invokeEdge(fnName, body, userToken) {
  const headers = {
    'apikey':        SUPABASE_ANON,
    'Authorization': `Bearer ${userToken || SUPABASE_ANON}`,
    'Content-Type':  'application/json',
  };
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
  });
  return resp.json();
}

// ── SANITISE FILENAME ─────────────────────────────────────────────
function safeFilename(name) {
  return (name || 'designi_file')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);
}

// ── WRAP BUFFER IN ZIP (skip if already ZIP) ──────────────────────
async function respondZip(res, buffer, filename) {
  const safe = safeFilename(filename);
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
  const zipName = safe.endsWith('.zip') ? safe : safe.replace(/\.[^.]+$/, '') + '.zip';

  let out;
  if (isZip) {
    out = Buffer.from(buffer);          // already a ZIP — serve as-is
  } else {
    const zip = new JSZip();
    zip.file(safe, buffer);
    out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }
  res.header('Content-Type',        'application/zip');
  res.header('Content-Disposition', `attachment; filename="${zipName}"`);
  res.header('X-Filename',           zipName);
  return res.send(out);
}

// ── /proxy — MAIN DOWNLOAD ENDPOINT ──────────────────────────────
app.get('/proxy', async (req, res) => {
  try {
    const DESIGNI_TOKEN = process.env.DESIGNI_TOKEN;
    if (!DESIGNI_TOKEN) {
      return res.status(503).json({ error: 'DESIGNI_TOKEN not configured on server.' });
    }

    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing ?url= parameter.' });
    }

    // ── 1. Extract the URL hash from the Designi page URL ──
    // e.g. https://www.designi.com.br/ba0f354444bc10f6  →  ba0f354444bc10f6
    const urlHash = targetUrl.replace(/\/$/, '').split('/').pop();
    if (!urlHash) {
      return res.status(400).json({ error: 'Could not extract hash from URL.' });
    }
    console.log(`[proxy] hash=${urlHash}`);

    // ── 2. Meilisearch lookup — get file metadata ──
    const metaResp = await invokeEdge('meilisearch-proxy', {
      action:     'getDesignDetailData',
      documentId: urlHash,
    });

    // Response is nested: { design: { id, originalFilename, extension, shortUrl, ... } }
    const meta = metaResp && metaResp.design ? metaResp.design : metaResp;

    if (!meta || meta.error || !meta.id) {
      console.error('[proxy] meilisearch-proxy error:', metaResp);
      return res.status(404).json({ error: 'File not found in index.', detail: metaResp });
    }

    const fileId   = parseInt(meta.id, 10);
    const rawName  = meta.originalFilename || meta.title || urlHash;
    const ext      = (meta.extension || '').replace(/^\./, '');
    const filename = ext && !rawName.toLowerCase().endsWith('.' + ext)
      ? rawName + '.' + ext
      : rawName;
    console.log(`[proxy] fileId=${fileId}  filename=${filename}`);

    // ── 3. Register the download — token from env var OR X-DT request header ──
    // The admin panel stores the token in a cookie; the frontend passes it as X-DT.
    const requestToken = req.headers['x-dt'] || DESIGNI_TOKEN;
    if (!requestToken) {
      return res.status(503).json({
        error: 'No Designi token configured. Set it in the Admin Panel → Designi Token field.'
      });
    }
    const dlData = await invokeEdge('register-download', { file_id: fileId }, requestToken);

    if (!dlData || dlData.error || dlData.message) {
      console.error('[proxy] register-download error:', dlData);
      const msg = (dlData && (dlData.error || dlData.message)) || 'register-download failed';
      return res.status(403).json({ error: msg, detail: dlData });
    }

    // ── 4. Build the real download URL ──
    const downloadUrl =
      dlData.s3_download_url ||
      dlData.download_url    ||
      (dlData.shortUrl
        ? `https://app.designi.com.br/${dlData.shortUrl}?token=${dlData.token || ''}`
        : null);

    if (!downloadUrl) {
      console.error('[proxy] no download URL in response:', dlData);
      return res.status(500).json({ error: 'No download URL returned.', detail: dlData });
    }
    console.log(`[proxy] downloadUrl=${downloadUrl.slice(0, 80)}…`);

    // ── 5. Fetch the actual file bytes ──
    const fileResp = await fetch(downloadUrl, {
      headers: {
        ...UA,
        'Authorization': `Bearer ${DESIGNI_TOKEN}`,
      },
      redirect: 'follow',
    });

    if (!fileResp.ok) {
      return res.status(fileResp.status).json({
        error:  'File fetch failed.',
        status: fileResp.status,
        url:    downloadUrl.slice(0, 120),
      });
    }

    const buffer = await fileResp.arrayBuffer();
    console.log(`[proxy] fetched ${buffer.byteLength} bytes → serving as ZIP`);

    // ── 6. Wrap in ZIP and return ──
    return respondZip(res, buffer, dlData.file_name || filename);

  } catch (err) {
    console.error('[proxy] uncaught error:', err);
    res.header('X-Error', String(err.message));
    return res.status(500).json({ error: err.message });
  }
});

// ── One-time token setup (call once after deploy) ────────────────
app.get('/setup', (req, res) => {
  const { token, pass } = req.query;
  if (pass !== 'DesigniAdmin2024!') return res.status(403).json({ error: 'Wrong password.' });
  if (!token || token.length < 20) return res.status(400).json({ error: 'Token too short.' });
  process.env.DESIGNI_TOKEN = token;
  try { writeFileSync(TOKEN_FILE, token, 'utf8'); } catch(e) { /* ephemeral disk, ignore */ }
  console.log('DESIGNI_TOKEN set via /setup endpoint.');
  res.json({ ok: true, prefix: token.slice(0, 8) + '...' });
});

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', version: '3.0', token_set: !!process.env.DESIGNI_TOKEN }));

// ── Static files + SPA fallback ───────────────────────────────────
app.use(express.static(__dirname));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`DesigniDL proxy v3.0  →  http://localhost:${PORT}`));
