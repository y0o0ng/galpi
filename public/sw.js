'use strict';

// 새 SW를 대기시키지 않고 바로 넘겨받는다. 기본 동작은 열려 있는 창이 전부 닫혀야
// 활성화되는데, 홈 화면 PWA는 사용자가 앱을 완전히 종료할 때까지 그 창이 살아 있어서
// 서버는 새 payload를 보내는데 잠금화면 문구만 옛 SW의 것으로 나가는 구간이 생긴다.
// 이 SW는 push·notificationclick 둘뿐이고 fetch 가로채기도 캐시도 없어서 즉시 교체가
// 반쪽짜리 자산을 만들지 않는다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch { /* 일반 문구로 표시 */ }
  // payload는 routing metadata만 담는다(설계 13.1 · 뉴스 11.5). 문구는 여기서
  // 고정이고 SW가 내용을 조회하거나 조합하지 않는다. type이 없는 옛 payload는
  // 일정으로 읽어, 배포된 구버전 SW와 새 서버가 섞여도 일정 알림이 깨지지 않는다.
  const safeInt = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const kinds = {
    mail_attention: {
      heading: 'XION 메일 알림',
      body: '확인할 메일이 있어. 앱에서 내용을 확인해줘.',
      fallbackUrl: '/?panel=notifications&notification=mail',
      // 회차를 tag에 넣지 않으면 snooze 재알림이 이전 알림을 덮어쓴다.
      tag: () => `mail-attention:${payload.targetKind || 'message'}:${safeInt(payload.targetId) ?? 'unknown'}:${safeInt(payload.notifySeq) ?? 1}`,
    },
    // 재확인은 알림이 아니라 시온이 먼저 거는 말이다. 주제도 질문도 싣지 않으므로
    // 문구는 무엇을 물어보는지 밝히지 않는다.
    news_review: {
      heading: '시온',
      body: '물어볼 게 하나 있어.',
      fallbackUrl: '/',
      tag: () => `news-review:${safeInt(payload.candidateId) ?? 'unknown'}`,
    },
  };
  const kind = kinds[payload.type] || {
    heading: 'XION 일정 알림',
    body: '확인할 일정이 있어. 앱에서 내용을 확인해줘.',
    fallbackUrl: '/?panel=agents&taskView=reminders',
    tag: () => `task-reminder:${safeInt(payload.reminderId) ?? 'unknown'}`,
  };
  const url = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : kind.fallbackUrl;
  event.waitUntil(self.registration.showNotification(
    kind.heading,
    {
      body: kind.body,
      icon: '/lib/icons/Xion/xion-app-icon-192.png',
      badge: '/lib/icons/Xion/xion-mark.svg',
      tag: kind.tag(),
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
