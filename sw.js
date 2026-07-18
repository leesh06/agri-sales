'use strict';

/* 앱을 오프라인에서도 열 수 있게 하는 서비스 워커 */
const CACHE_NAME = 'ledger-v2';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 구글시트 통신 등 외부 요청은 건드리지 않음
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(req) {
  try {
    // no-cache: CDN 10분 캐시를 건너뛰고 항상 서버에 최신인지 확인 (수정 즉시 반영)
    const res = await fetch(req, { cache: 'no-cache' });
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
