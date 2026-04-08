/**
 * DesigniDL — CORS Proxy Function
 * Fetches files from Designi servers on behalf of the browser client.
 * This bypasses CORS since server-to-server requests aren't restricted.
 *
 * Usage: /.netlify/functions/proxy?url=<encoded-file-url>
 *
 * Netlify Functions have a ~6MB response limit for synchronous functions.
 * For larger files, the client falls back to "Open ↗" direct link.
 */

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
      body: '',
    };
  }

  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing "url" query parameter' }),
    };
  }

  // Basic URL validation
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid URL' }),
    };
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Only HTTP/HTTPS URLs allowed' }),
    };
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.designi.com.br/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Upstream returned ${response.status} ${response.statusText}` }),
      };
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Check size — Netlify has ~6MB limit for base64 encoded sync responses
    if (buffer.byteLength > 5.5 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'File too large for proxy (>5.5MB). Use direct link.' }),
      };
    }

    // Convert to base64 for Netlify Function response
    const base64 = Buffer.from(buffer).toString('base64');

    // Extract filename from URL or Content-Disposition
    let filename = parsed.pathname.split('/').pop() || 'download';
    const cdHeader = response.headers.get('content-disposition');
    if (cdHeader) {
      const match = cdHeader.match(/filename[^;=\n]*=(['"]?)([^'";\n]+)\1/);
      if (match) filename = match[2];
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Proxy-Content-Length': buffer.byteLength.toString(),
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Proxy fetch failed: ' + err.message }),
    };
  }
}
