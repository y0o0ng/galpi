'use strict';

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch { /* 일반 문구로 표시 */ }
  // 메일 payload는 routing metadata만 담는다(설계 13.1). 문구는 여기서 고정이고
  // SW가 내용을 조회하거나 조합하지 않는다. type이 없는 옛 payload는 일정으로 읽어
  // 배포된 구버전 SW와 새 서버가 섞여도 일정 알림이 깨지지 않게 한다.
  const isMail = payload.type === 'mail_attention';
  const safeInt = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const fallbackUrl = isMail
    ? '/?panel=notifications&notification=mail'
    : '/?panel=agents&taskView=reminders';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : fallbackUrl;
  // 회차를 tag에 넣지 않으면 snooze 재알림이 이전 알림을 덮어쓴다.
  const tag = isMail
    ? `mail-attention:${payload.targetKind || 'message'}:${safeInt(payload.targetId) ?? 'unknown'}:${safeInt(payload.notifySeq) ?? 1}`
    : `task-reminder:${safeInt(payload.reminderId) ?? 'unknown'}`;
  event.waitUntil(self.registration.showNotification(
    isMail ? 'XION 메일 알림' : 'XION 일정 알림',
    {
      body: isMail
        ? '확인할 메일이 있어. 앱에서 내용을 확인해줘.'
        : '확인할 일정이 있어. 앱에서 내용을 확인해줘.',
      icon: '/lib/icons/Xion/xion-app-icon-192.png',
      badge: '/lib/icons/Xion/xion-mark.svg',
      tag,
      renotify: false,
      data: { url },
    },
  ));
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
