import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** Minimal payload for admin live feed (no PII beyond ids). */
export function publishAuditEventMini(payload) {
  try {
    bus.emit('audit', payload);
  } catch (_e) {
    /* noop */
  }
}

export function subscribeAuditEvents(handler) {
  bus.on('audit', handler);
  return () => bus.off('audit', handler);
}
