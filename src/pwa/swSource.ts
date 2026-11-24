/**
 * The Brain service worker's source. vite.config.ts (`brainServiceWorker`)
 * emits it as /sw.js with the version and the exact list of built files to
 * precache. It lives in a TS string so the build needs no Node APIs.
 *
 * - Opens offline: the app shell is precached, and a page load falls back to
 *   it when the network is gone. Capturing then works as always, because the
 *   outbox writes to IndexedDB first and sends when Brain is reachable.
 * - Never caches the API (/v1) or sign-in: those always go to the network.
 * - Fires local reminders from the digest the page stores in IndexedDB
 *   (src/pwa/reminders.ts; keep the database shape in step).
 */
export function serviceWorkerSource(version: string, precache: string[]): string {
  return SOURCE.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
}

/** Small and stable: changes whenever the precache list does. */
export function versionOf(files: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of files.join('\n')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const SOURCE = String.raw`const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = 'brain-shell-' + VERSION;
const RUNTIME = 'brain-runtime-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('brain-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: show the cached copy, refresh it in the background.
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The API and auth are never served from a cache.
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/auth/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req));
    return;
  }
  event.respondWith(cacheFirst(req, url.pathname.startsWith('/assets/')));
});

// Built files are content-hashed, so a cached copy is always right. One loaded
// lazily (not in the precache list) is kept the first time it is fetched.
async function cacheFirst(req, keep) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (keep && res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

async function networkFirstPage(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put('/', res.clone());
    return res;
  } catch {
    return (await caches.match('/')) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

// ---- reminders ----
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('brain-reminders', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = fn(db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => { resolve(req.result); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    };
  });
}

function wallNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hhmm: p.hour + ':' + p.minute };
}

async function fireDue() {
  const digest = await idb('readonly', (s) => s.get('digest'));
  if (!digest) return;
  const shown = new Set((await idb('readonly', (s) => s.get('shown'))) || []);
  const { day, hhmm } = wallNow(digest.tz);
  const due = digest.reminders.filter((r) => r.day === day && r.at <= hhmm && !shown.has(r.id));
  if (!due.length) return;
  await idb('readwrite', (s) => s.put([...shown, ...due.map((r) => r.id)].slice(-200), 'shown'));
  for (const r of due) {
    await self.registration.showNotification(r.title, { body: r.body, tag: r.id, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: r.url } });
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'brain-reminders') event.waitUntil(fireDue());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) { await open.focus(); open.navigate?.(url); } else await self.clients.openWindow(url);
  })());
});
`;
