// Офлайн-режим и быстрый запуск: сразу отдаю сохранённую копию, свежую версию
// скачиваю в фоне. Если страница изменилась, сообщаю ей, чтобы показала плашку обновления.
// При изменении списка файлов или логики этого файла увеличь номер версии кэша.
const CACHE_NAME = "work-schedule-v2";

const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  // cache: "reload" — мимо HTTP-кэша браузера, чтобы не сохранить устаревшие файлы
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Убираю кэши старых версий
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) {
    return;
  }

  event.respondWith(respond(event));
});

async function respond(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  // Копию делаю заранее: тело cached браузер прочитает, когда я отдам её странице
  const update = revalidate(event, cache, cached ? cached.clone() : null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }

  // В кэше нет — жду сеть, а без сети отдаю главную страницу
  const fresh = await update;
  return fresh || (await cache.match("./")) || Response.error();
}

// Скачивает свежую версию и кладёт в кэш. Возвращает ответ или null без сети.
async function revalidate(event, cache, cached) {
  const request = event.request;

  try {
    const url = new URL(request.url);
    url.search = "";

    // no-cache: браузер сверится с сервером, при отсутствии изменений придёт короткий 304
    const response = await fetch(url.href, { cache: "no-cache" });

    if (!response.ok) {
      return response;
    }

    const isPage = request.mode === "navigate" || request.destination === "document";
    let changed = false;

    if (isPage && cached) {
      const [oldText, newText] = await Promise.all([
        cached.text(),
        response.clone().text()
      ]);
      changed = oldText !== newText;
    }

    await cache.put(url.href, response.clone());

    if (changed) {
      await notifyUpdate(event.resultingClientId || event.clientId);
    }

    return response;
  } catch (error) {
    return null;
  }
}

// Страница может ещё загружаться, поэтому жду её появления до ~5 секунд
async function notifyUpdate(clientId) {
  const message = { type: "update-available" };

  for (let i = 0; i < 20 && clientId; i++) {
    const client = await self.clients.get(clientId);

    if (client) {
      client.postMessage(message);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const windows = await self.clients.matchAll({ type: "window" });
  windows.forEach((client) => client.postMessage(message));
}
