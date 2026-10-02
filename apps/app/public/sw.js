// Static service worker (no bundler). Receives Web Push reminders and routes
// a notification click back into the todos app.
'use strict';

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
      icon: '/icon-todos.png',
      badge: '/icon-todos.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find((client) => new URL(client.url).pathname.startsWith('/todos'));
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      }),
  );
});
