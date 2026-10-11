// Page-world bridge: session headers stay here and are never sent to the extension.
(() => {
  if (window.__micaRawBridge) return;
  window.__micaRawBridge = true;
  const nativeFetch = window.fetch.bind(window);
  let headers = new Headers(), busy = false;
  window.fetch = function(input, init) {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/backend-api/')) {
        const next = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => next.set(key, value));
        // Preserve authorization when another API call contains only content-type.
        next.forEach((value, key) => { if (/^(authorization|oai-device-id|oai-language|chatgpt-account-id)$/i.test(key)) headers.set(key, value); });
      }
    } catch {}
    return nativeFetch(input, init);
  };
  window.addEventListener('mica-reader-request', async event => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    const current = location.pathname.match(/\/c\/([^/?#]+)/)?.[1];
    if (!current || request.conversationId !== current || typeof request.requestId !== 'string') return;
    const reply = payload => window.dispatchEvent(new CustomEvent('mica-reader-result', { detail: JSON.stringify({ requestId: request.requestId, conversationId: current, ...payload }) }));
    if (busy) { reply({ error: '正在读取原始会话，请稍后重试' }); return; }
    busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    try {
      const result = await MicaConversationAPI.load(nativeFetch, location.origin, current, { credentials: 'include', headers, signal: controller.signal });
      reply(result);
    } catch (error) { reply({ error: error.name === 'AbortError' ? '读取原始会话超时，请重试' : error.message }); }
    finally { busy = false; clearTimeout(timer); }
  });
})();
