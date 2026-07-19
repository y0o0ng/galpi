'use strict';

(function setupPushClient(global) {
  const state = {
    initialized: false,
    apiFetch: null,
    config: null,
    registration: null,
    status: 'checking',
    label: '확인 중',
    lastRegisteredEndpoint: null,
    activeRequest: null,
  };

  function publicState() {
    return { status: state.status, label: state.label };
  }

  function setStatus(status, label) {
    state.status = status;
    state.label = label;
    return publicState();
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return global.matchMedia?.('(display-mode: standalone)').matches === true
      || navigator.standalone === true;
  }

  function supportsPush() {
    return global.isSecureContext === true
      && 'serviceWorker' in navigator
      && 'PushManager' in global
      && 'Notification' in global;
  }

  function applicationServerKey(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = global.atob(base64);
    return Uint8Array.from(raw, character => character.charCodeAt(0));
  }

  async function loadConfig() {
    if (state.config) return state.config;
    const response = await state.apiFetch('/api/push/config');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '알림 설정을 확인하지 못했습니다.');
    state.config = data;
    return data;
  }

  async function ensureRegistration() {
    if (state.registration) return state.registration;
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    state.registration = await navigator.serviceWorker.ready;
    return state.registration;
  }

  async function registerOnServer(subscription) {
    if (state.lastRegisteredEndpoint === subscription.endpoint) return;
    const serialized = subscription.toJSON();
    const response = await state.apiFetch('/api/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: serialized.endpoint,
        keys: serialized.keys,
        deviceLabel: isIos() ? 'iOS 홈 화면' : '갈피 웹앱',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '알림 구독을 저장하지 못했습니다.');
    state.lastRegisteredEndpoint = subscription.endpoint;
  }

  async function refreshInternal() {
    setStatus('checking', '확인 중');
    let config;
    try {
      config = await loadConfig();
    } catch {
      return setStatus('ready', '알림 준비 중');
    }
    if (!config.enabled) return setStatus('ready', '알림 준비 중');
    if (location.origin !== config.canonicalOrigin || !supportsPush()) {
      return setStatus('unsupported', '알림 미지원');
    }
    if (isIos() && !isStandalone()) return setStatus('unsupported', '알림 미지원');
    if (Notification.permission === 'denied') return setStatus('blocked', '알림 차단됨');

    let registration;
    try {
      registration = await ensureRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return setStatus('available', '알림 켜기');
      await registerOnServer(subscription);
      return setStatus('enabled', '알림 켜짐');
    } catch {
      return setStatus('available', '알림 켜기');
    }
  }

  function refresh() {
    if (!state.initialized) throw new Error('PushClient가 초기화되지 않았습니다.');
    if (state.activeRequest) return state.activeRequest;
    const request = refreshInternal();
    state.activeRequest = request;
    return request.finally(() => {
      if (state.activeRequest === request) state.activeRequest = null;
    });
  }

  async function enable() {
    if (!state.initialized) throw new Error('PushClient가 초기화되지 않았습니다.');
    if (state.status !== 'available') return false;
    const config = await loadConfig();
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'blocked' : 'available', permission === 'denied' ? '알림 차단됨' : '알림 켜기');
      return false;
    }

    const registration = await ensureRegistration();
    let subscription = await registration.pushManager.getSubscription();
    const created = !subscription;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(config.publicKey),
      });
    }
    try {
      await registerOnServer(subscription);
    } catch (error) {
      if (created) await subscription.unsubscribe().catch(() => false);
      setStatus('available', '알림 켜기');
      throw error;
    }
    setStatus('enabled', '알림 켜짐');
    return true;
  }

  function init({ apiFetch }) {
    if (state.initialized) return;
    if (typeof apiFetch !== 'function') throw new TypeError('apiFetch가 필요합니다.');
    state.apiFetch = apiFetch;
    state.initialized = true;
  }

  global.PushClient = { enable, getState: publicState, init, refresh };
})(window);
