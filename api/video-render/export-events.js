/**
 * Export job SSE pub/sub — one channel per jobId.
 */
import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** @type {Map<string, Set<(payload: object) => void>>} */
const jobChannels = new Map();

export function subscribeExportJob(jobId, listener) {
  const id = String(jobId || '');
  if (!id || typeof listener !== 'function') return () => {};
  let set = jobChannels.get(id);
  if (!set) {
    set = new Set();
    jobChannels.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) jobChannels.delete(id);
  };
}

export function publishExportJobUpdate(jobId, payload) {
  const id = String(jobId || '');
  if (!id || !payload) return;
  const set = jobChannels.get(id);
  if (set) {
    for (const fn of set) {
      try {
        fn(payload);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
  bus.emit(`job:${id}`, payload);
}

export function onExportBusEvent(jobId, listener) {
  const id = String(jobId || '');
  if (!id) return () => {};
  const key = `job:${id}`;
  bus.on(key, listener);
  return () => bus.off(key, listener);
}
