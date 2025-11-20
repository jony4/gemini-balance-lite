import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {

  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running!  More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // 处理 CORS preflight 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  // 处理OpenAI格式请求
  if (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/completions") || url.pathname.endsWith("/embeddings") || url.pathname.endsWith("/models")) {
    return openai.fetch(request);
  }

  // 处理文件上传请求 - 使用不同的域名
  let targetUrl;
  if (pathname.startsWith('/upload/')) {
    targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  } else {
    targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;
  }

  try {
    const headers = new Headers();
    
    // 需要排除的请求头（由浏览器/客户端自动管理，不应转发）
    const excludeRequestHeaders = [
      'host',           // 会自动设置为目标主机
      'connection',     // 连接管理
      'origin',         // CORS 相关
      'referer',        // 来源信息
      'user-agent',     // 可能被 Cloudflare 修改
      'accept-encoding' // 编码由 fetch 自动处理
    ];
    
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.trim().toLowerCase();
      
      // 处理 API Key（支持多 key 负载均衡）
      if (lowerKey === 'x-goog-api-key') {
        const apiKeys = value.split(',').map(k => k.trim()).filter(k => k);
        if (apiKeys.length > 0) {
          const selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
          console.log(`Gemini Selected API Key: ${selectedKey}`);
          headers.set('x-goog-api-key', selectedKey);
        }
      } 
      // 转发所有 x-goog-* 开头的 headers（Google 专用）
      else if (lowerKey.startsWith('x-goog-')) {
        headers.set(key, value);
      }
      // 转发 content-* headers（内容相关）
      else if (lowerKey.startsWith('content-')) {
        headers.set(key, value);
      }
      // 排除不应转发的 headers
      else if (!excludeRequestHeaders.includes(lowerKey)) {
        // 其他 headers 也转发（如 authorization, accept 等）
        headers.set(key, value);
      }
    }

    console.log('Request Sending to Gemini')
    console.log('targetUrl:'+targetUrl)
    console.log(headers)

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.log("Call Gemini Success")

    const responseHeaders = new Headers();

    console.log('Headers from Gemini:')
    
    // 需要排除的响应头（由 Cloudflare Workers 自动管理）
    const excludeResponseHeaders = [
      'transfer-encoding',  // 传输编码由 Workers 管理
      'connection',         // 连接管理
      'keep-alive',         // 连接保持
      'content-encoding'    // 内容编码由 Workers 自动处理
    ];
    
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      
      if (!excludeResponseHeaders.includes(lowerKey)) {
        // 特殊处理：如果是 x-goog-upload-url，需要将其改写为通过代理的 URL
        if (lowerKey === 'x-goog-upload-url') {
          // 将 Google 的 URL 改写为通过我们代理的 URL
          // 例如：https://generativelanguage.googleapis.com/upload/v1beta/files/abc123
          // 改为：https://our-proxy.com/upload/v1beta/files/abc123
          try {
            const uploadUrl = new URL(value);
            const proxyUploadUrl = `${url.protocol}//${url.host}${uploadUrl.pathname}${uploadUrl.search}`;
            responseHeaders.set(key, proxyUploadUrl);
            console.log(`  ${key}: ${value} -> ${proxyUploadUrl} (rewritten)`);
          } catch (e) {
            // 如果 URL 解析失败，保持原值
            console.warn(`  Failed to rewrite upload URL: ${value}`, e);
            responseHeaders.set(key, value);
          }
        } else {
          responseHeaders.set(key, value);
          console.log(`  ${key}: ${value}`);
        }
      }
    }
    
    // 添加安全相关的 headers
    responseHeaders.set('Referrer-Policy', 'no-referrer');
    
    // CORS 支持（如果需要从浏览器调用）
    if (request.headers.get('origin')) {
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', '*');
      responseHeaders.set('Access-Control-Expose-Headers', '*');
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
   console.error('Failed to fetch:', error);
   return new Response('Internal Server Error\n' + error?.stack, {
    status: 500,
    headers: { 'Content-Type': 'text/plain' }
   });
}
};
