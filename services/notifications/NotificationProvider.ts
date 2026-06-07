/**
 * Abstraction for notification delivery channels.
 * Realtime (WebSocket / Pusher / Ably / SSE) can plug in here later.
 */
import type { NotificationRecord } from './types';

export type NotificationDeliveryChannel =
  | 'in_app'
  | 'email'
  | 'push'
  | 'browser'
  | 'mobile'
  | 'slack'
  | 'webhook';

export type NotificationDeliveredEvent = {
  channel: NotificationDeliveryChannel;
  notification: NotificationRecord;
  userId: string;
};

type Listener = (event: NotificationDeliveredEvent) => void;

export class NotificationProvider {
  private listeners = new Set<Listener>();

  onDelivered(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async deliverInApp(notification: NotificationRecord, userId: string): Promise<void> {
    await this.emit({ channel: 'in_app', notification, userId });
  }

  /** Future: push / mobile / slack / webhook handlers register here */
  async deliver(channel: NotificationDeliveryChannel, notification: NotificationRecord, userId: string) {
    await this.emit({ channel, notification, userId });
  }

  private async emit(event: NotificationDeliveredEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[NotificationProvider] listener failed', (err as Error)?.message || err);
      }
    }
  }
}

export const defaultNotificationProvider = new NotificationProvider();
