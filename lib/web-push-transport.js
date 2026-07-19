'use strict';

function createWebPushTransport(webPush, options = {}) {
  if (typeof webPush?.sendNotification !== 'function') {
    throw new TypeError('web-push client가 필요합니다.');
  }
  const subject = String(options.subject || '').trim();
  const publicKey = String(options.publicKey || '').trim();
  const privateKey = String(options.privateKey || '').trim();
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 10_000;
  if (!subject || !publicKey || !privateKey) {
    throw new TypeError('VAPID subject·public key·private key가 필요합니다.');
  }

  return {
    name: 'web_push',
    send(subscription, payload, delivery) {
      return webPush.sendNotification(subscription, payload, {
        vapidDetails: { subject, publicKey, privateKey },
        TTL: delivery.ttl,
        timeout: timeoutMs,
        urgency: delivery.urgency,
        topic: delivery.topic,
      });
    },
  };
}

module.exports = { createWebPushTransport };
