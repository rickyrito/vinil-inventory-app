const CACHE_PREFIX = 'vinil-' + new URL(self.registration.scope).pathname + '-shell-';
const VERSION = CACHE_PREFIX + 'v4';
const SHELL = ['./', './index.html', './styles.css', './app.mjs', './core.mjs', './storage.mjs', './google.mjs',
  './hosting.json', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './vendor/zxing.min.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)));
  // Ativação na próxima abertura: não interromper formulários nem misturar versões.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const pathname = new URL(event.request.url).pathname;
  // Uma navegação OAuth tem de chegar sempre ao servidor, inclusive no modo standalone.
  if (pathname.startsWith('/auth/') || pathname.startsWith('/api/') || pathname === '/healthz') return;
  // Só o shell é guardado aqui. Tokens, API Google e dados privados nunca entram nesta cache.
  const allowed = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (event.request.mode !== 'navigate' && !allowed.includes(event.request.url)) return;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(event.request.mode === 'navigate' ? './index.html' : event.request);
    return cached || fetch(event.request);
  }));
});
