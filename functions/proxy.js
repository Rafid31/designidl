// Cloudflare Pages Function: /functions/proxy.js
// Handles download proxy requests with Designi.com.br scraping

export async function onRequest(context) {
  const { request, env } = context;
  
  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { url } = await request.json();
    
    if (!url || !url.startsWith('https://www.designi.com.br/')) {
      return new Response('Invalid URL', { status: 400 });
    }
    
    // Fetch the Designi page
    const pageResponse = await fetch(url);
    const html = await pageResponse.text();
    
    // Try multiple patterns to extract download URL
    const patterns = [
      /<a[^>]*href=["']([^"']*\.(zip|rar|7z|tar\.gz))["'][^>]*download/i,
      /<a[^>]*download[^>]*href=["']([^"']*\.(zip|rar|7z|tar\.gz))["']/i,
      /href=["']([^"']*\/download\/[^"']*)["']/i,
      /<a[^>]*class=["'][^"']*download[^"']*["'][^>]*href=["']([^"']*)["']/i,
      /window\.location\.href\s*=\s*["']([^"']*\.(zip|rar|7z|tar\.gz))["']/i
    ];
    
    let downloadUrl = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        downloadUrl = match[1];
        break;
      }
    }
    
    if (!downloadUrl) {
      return new Response('Download link not found', { status: 404 });
    }
    
    // Make download URL absolute
    if (downloadUrl.startsWith('/')) {
      downloadUrl = 'https://www.designi.com.br' + downloadUrl;
    } else if (!downloadUrl.startsWith('http')) {
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      downloadUrl = baseUrl + downloadUrl;
    }
    
    // Fetch the actual file
    const fileResponse = await fetch(downloadUrl);
    
    if (!fileResponse.ok) {
      return new Response('Download failed', { status: fileResponse.status });
    }
    
    // Stream the file back with proper headers
    const headers = new Headers(fileResponse.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Content-Type', 'application/zip');
    headers.set('Content-Disposition', 'attachment; filename="download.zip"');
    
    return new Response(fileResponse.body, {
      status: 200,
      headers: headers
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response('Server error: ' + error.message, { status: 500 });
  }
}
