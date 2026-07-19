'use strict';

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch { /* 일반 문구로 표시 */ }
  const reminderId = Number.isSafeInteger(Number(payload.reminderId)) && Number(payload.reminderId) > 0
    ? Number(payload.reminderId)
    : 'unknown';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : '/?panel=agents&taskView=reminders';
  event.waitUntil(self.registration.showNotification('XION 일정 알림', {
    body: '확인할 일정이 있어. 앱에서 내용을 확인해줘.',
    icon: '/lib/icons/Xion/xion-app-icon.svg',
    badge: '/lib/icons/Xion/xion-mark.svg',
    tag: `task-reminder:${reminderId}`,
    renotify: false,
    data: { url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('/?panel=agents&taskView=reminders', self.location.origin);
  try {
    const requested = new URL(event.notification.data?.url || '/', self.location.origin);
    if (requested.origin === self.location.origin) target = requested;
  } catch { /* 기본 앱 경로 사용 */ }

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const current = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (current) return current.navigate(target.href).then(client => client?.focus());
    return self.clients.openWindow(target.href);
  }));
});
