// Service worker : reçoit les push envoyés par la routine AguilaRadar et affiche
// la notification système, même si l'app est complètement fermée. Ne met rien en
// cache (le site n'a pas besoin de fonctionner hors-ligne) — son seul rôle est le push.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "AguilaRadar", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "AguilaRadar";
  const options = {
    body: data.body || "",
    icon: "apple-touch-icon.png",
    tag: data.tag || "aguilaradar-digest",
    data: { url: data.url || "./" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
