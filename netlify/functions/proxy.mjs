/**
 * DesigniDL — CORS Proxy + Designi Scraper
 * Fetches files from Designi. If the URL is a landing page, scrapes the real download link.
 * Returns files as ZIP format when possible.
 */

import JSZip from 'https://cdn.skypack.dev/jszip@3.10.1';

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
    // STRATEGY: Check if this is a Designi landing page
    const isDesigniLanding = parsed.hostname.includes('designi.com') && 
                             !parsed.pathname.match(/\.(psd|png|jpg|svg|ai|eps|pdf|zip|mp4)$/i);

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
        throw new Error(`Failed to fetch landing page: ${htmlResp.status}`);
      }

      const html = await htmlResp.text();

      // Try multiple patterns to extract download URL
      let dlUrl = null;

      // Pattern 1: Look for direct download link in <a> tags
      const linkMatch = html.match(/<a[^>]*href=["']([^"']*download[^"']*)["'][^>]*>/i);
      if (linkMatch) dlUrl = linkMatch[1];

      // Pattern 2: Look in JavaScript variables
      if (!dlUrl) {
        const jsMatch = html.match(/download[Uu]rl["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (jsMatch) dlUrl = jsMatch[1];
      }

      // Pattern 3: Look for data-download attributes
      if (!dlUrl) {
        const dataMatch = html.match(/data-download=["']([^"']+)["']/i);
        if (dataMatch) dlUrl = dataMatch[1];
      }

      // Pattern 4: Look for any .psd/.ai/.eps links
      if (!dlUrl) {
        const fileMatch = html.match(/href=["']([^"']*\.(psd|ai|eps|png|jpg|svg|pdf|zip)[^"']*)["']/i);
        if (fileMatch) dlUrl = fileMatch[1];
      }

      if (dlUrl) {
        // Make absolute URL
        if (dlUrl.startsWith('/')) {
          dlUrl = `${parsed.protocol}//${parsed.hostname}${dlUrl}`;
        } else if (!dlUrl.startsWith('http')) {
          dlUrl = `${parsed.protocol}//${parsed.hostname}/${dlUrl}`;
        }
        fileUrl = dlUrl;

        // Extract filename from the download URL
        try {
          const dlParsed = new URL(dlUrl);
          const fname = dlParsed.pathname.split('/').pop();
          if (fname) originalFilename = fname;
        } catch {}
      } else {
        // Couldn't find download link - return error
        return {
          statusCode: 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Could not extract download link from Designi page' }),
        };
      }
    }

    // Now fetch the actual file
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

    // Check size — Netlify has ~6MB limit
    if (buffer.byteLength > 5.5 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'File too large for proxy (>5.5MB)' }),
      };
    }

    // Create ZIP archive
    const zip = new JSZip();
    
    // Add the file to ZIP with original name
    let finalFilename = originalFilename;
    if (!finalFilename.includes('.')) {
      // Add extension based on content-type
      const extMap = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf',
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
      if (!finalFilename.includes('.')) finalFilename += '.psd'; // default
    }

    zip.file(finalFilename, buffer);

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ 
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Convert to base64 for Netlify response
    let binary = '';
    for (let i = 0; i < zipBlob.length; i++) {
      binary += String.fromCharCode(zipBlob[i]);
    }
    const base64 = btoa(binary);

    // Remove extension from original filename and add .zip
    const zipFilename = finalFilename.replace(/\.[^.]+$/, '') + '.zip';

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'X-Proxy-Success': 'true',
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
