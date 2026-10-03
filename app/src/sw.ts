/// <reference lib="webworker" />
// Service Worker: App offline verfügbar machen (Precache) und – per Background Sync – die Outbox
// hochladen, sobald wieder Netz da ist, auch wenn die App gerade geschlossen ist (Chrome/Android).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { BACKGROUND_SYNC_TAG, flushFromDb } from "./lib/syncCore.ts";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// „Update installieren“ in der App
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

async function backgroundSync() {
  const windows = await self.clients.matchAll({ type: "window" });
  // Ist die App offen, gleicht sie selbst ab (sie kennt ihren Zustand im Speicher).
  if (windows.some((c) => c.visibilityState === "visible")) {
    for (const c of windows) c.postMessage({ type: "sync-now" });
    return;
  }
  await flushFromDb();
  for (const c of windows) c.postMessage({ type: "synced" });
}

self.addEventListener("sync", (event) => {
  const e = event as SyncEvent;
  if (e.tag === BACKGROUND_SYNC_TAG) e.waitUntil(backgroundSync());
});
