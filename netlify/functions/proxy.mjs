/**
 * DesigniDL — CORS Proxy + Designi Scraper
 * Fetches files from Designi. If URL is a landing page, scrapes real download link.
 */

export async function handler(event) {
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

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Only HTTP/HTTPS URLs allowed' }),
    };
  }

  try {
    // Check if this is a Designi landing page (no file extension)
    const isDesigniLanding = parsed.hostname.includes('designi.com') && 
                             !parsed.pathname.match(/\.(psd|png|jpg|svg|ai|eps|pdf|zip|mp4|jpeg|gif|webp)$/i);

    let fileUrl = targetUrl;
    let originalFilename = parsed.pathname.split('/').pop() || 'download';

    if (isDesigniLanding) {
      // Fetch the landing page HTML
      const htmlResp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!htmlResp.ok) {
        throw new Error(`Landing page fetch failed: ${htmlResp.status}`);
      }

      const html = await htmlResp.text();

      // Try multiple patterns to extract download URL
      let dlUrl = null;

      // Pattern 1: <a> tags with download in href
      let match = html.match(/<a[^>]*href=["']([^"']*download[^"']*)["'][^>]*>/i);
      if (match) dlUrl = match[1];

      // Pattern 2: JavaScript variables
      if (!dlUrl) {
        match = html.match(/download[Uu]rl["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (match) dlUrl = match[1];
      }

      // Pattern 3: data-download attributes
      if (!dlUrl) {
        match = html.match(/data-download=["']([^"']+)["']/i);
        if (match) dlUrl = match[1];
      }

      // Pattern 4: Any file links (.psd, .ai, etc)
      if (!dlUrl) {
        match = html.match(/href=["']([^"']*\.(psd|ai|eps|png|jpg|svg|pdf|zip|jpeg)[^"']*)["']/i);
        if (match) dlUrl = match[1];
      }

      // Pattern 5: Look for button onclick or data-url
      if (!dlUrl) {
        match = html.match(/(?:onclick|data-url)=["']([^"']*\.(psd|ai|eps|png|jpg)[^"']*)["']/i);
        if (match) dlUrl = match[1];
      }

      if (dlUrl) {
        // Make absolute URL
        if (dlUrl.startsWith('/')) {
          dlUrl = `${parsed.protocol}//${parsed.hostname}${dlUrl}`;
        } else if (!dlUrl.startsWith('http')) {
          dlUrl = `${parsed.protocol}//${parsed.hostname}/${dlUrl}`;
        }
        fileUrl = dlUrl;

        // Extract filename
        try {
          const dlParsed = new URL(dlUrl);
          const fname = dlParsed.pathname.split('/').pop();
          if (fname) originalFilename = fname;
        } catch {}
      } else {
        return {
          statusCode: 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Could not find download link on Designi page' }),
        };
      }
    }

    // Fetch the actual file
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.designi.com.br/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Upstream returned ${response.status}` }),
      };
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Check size
    if (buffer.byteLength > 5.5 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'File too large (>5.5MB)' }),
      };
    }

    // Add extension if filename doesn't have one
    let finalFilename = originalFilename;
    if (!finalFilename.includes('.')) {
      const extMap = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf',
        'application/zip': '.zip',
        'application/x-zip': '.zip',
        'application/postscript': '.eps',
        'application/illustrator': '.ai',
        'image/vnd.adobe.photoshop': '.psd',
        'application/x-photoshop': '.psd',
      };
      for (const [type, ext] of Object.entries(extMap)) {
        if (contentType.includes(type)) {
          finalFilename += ext;
          break;
        }
      }
      if (!finalFilename.includes('.')) finalFilename += '.zip'; // default
    }

    // Convert to base64
    const uint8 = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${finalFilename}"`,
      },
      body: base64,
      isBase64Encoded: true,
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Proxy failed: ' + err.message }),
    };
  }
}
