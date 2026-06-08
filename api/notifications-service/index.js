// services/notifications/types.ts
var NOTIFICATION_TYPES = {
  WELCOME: "WELCOME",
  EXPORT_COMPLETED: "EXPORT_COMPLETED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  SUBSCRIPTION_UPGRADED: "SUBSCRIPTION_UPGRADED",
  USAGE_WARNING_80: "USAGE_WARNING_80",
  USAGE_WARNING_100: "USAGE_WARNING_100",
  ACCOUNT_DELETION_REQUESTED: "ACCOUNT_DELETION_REQUESTED",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  SUPPORT_TICKET_CREATED: "SUPPORT_TICKET_CREATED",
  SUPPORT_TICKET_REPLY: "SUPPORT_TICKET_REPLY",
  SUPPORT_TICKET_ASSIGNED: "SUPPORT_TICKET_ASSIGNED",
  SUPPORT_TICKET_RESOLVED: "SUPPORT_TICKET_RESOLVED",
  SUPPORT_TICKET_CLOSED: "SUPPORT_TICKET_CLOSED",
  SECURITY_ALERT: "SECURITY_ALERT",
  SYSTEM_NOTIFICATION: "SYSTEM_NOTIFICATION"
};

// services/notifications/NotificationProvider.ts
var NotificationProvider = class {
  listeners = /* @__PURE__ */ new Set();
  onDelivered(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async deliverInApp(notification, userId) {
    await this.emit({ channel: "in_app", notification, userId });
  }
  /** Future: push / mobile / slack / webhook handlers register here */
  async deliver(channel, notification, userId) {
    await this.emit({ channel, notification, userId });
  }
  async emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("[NotificationProvider] listener failed", err?.message || err);
      }
    }
  }
};
var defaultNotificationProvider = new NotificationProvider();

// services/notifications/icons.ts
var ICONS = {
  WELCOME: "\u{1F44B}",
  EXPORT_COMPLETED: "\u{1F3AC}",
  PAYMENT_RECEIVED: "\u{1F4B3}",
  SUBSCRIPTION_UPGRADED: "\u{1F680}",
  USAGE_WARNING_80: "\u26A0\uFE0F",
  USAGE_WARNING_100: "\u26A0\uFE0F",
  ACCOUNT_DELETION_REQUESTED: "\u26A0\uFE0F",
  ACCOUNT_DELETED: "\u26A0\uFE0F",
  SUPPORT_TICKET_CREATED: "\u{1F3AB}",
  SUPPORT_TICKET_REPLY: "\u{1F4AC}",
  SUPPORT_TICKET_ASSIGNED: "\u{1F464}",
  SUPPORT_TICKET_RESOLVED: "\u2705",
  SUPPORT_TICKET_CLOSED: "\u{1F3AB}",
  SECURITY_ALERT: "\u{1F512}",
  SYSTEM_NOTIFICATION: "\u2699\uFE0F"
};
function notificationIcon(type) {
  return ICONS[type] || "\u2699\uFE0F";
}

// services/notifications/createNotification.ts
async function createNotification(input) {
  const userId = String(input.userId || "").trim();
  if (!userId) return { ok: false, reason: "missing_user_id" };
  const mod = await import("../../api/notifications-repository.js");
  const result = await mod.insertNotification({
    userId,
    type: input.type,
    title: input.title,
    message: input.message,
    metadata: input.metadata || {}
  });
  if (!result.ok || !result.notification) {
    return { ok: false, reason: result.reason || "insert_failed" };
  }
  await defaultNotificationProvider.deliverInApp(result.notification, userId);
  return { ok: true, notification: result.notification };
}

// services/notifications/eventMap.ts
function buildNotificationFromEvent(event, payload) {
  const first = String(payload.firstName || "there").trim() || "there";
  switch (event) {
    case "user_registered":
      return {
        type: NOTIFICATION_TYPES.WELCOME,
        title: "Welcome to Cutup",
        message: `Hi ${first}, your AI video workspace is ready.`,
        metadata: { event, href: "/dashboard.html#overview" }
      };
    case "export_completed":
      return {
        type: NOTIFICATION_TYPES.EXPORT_COMPLETED,
        title: "Export ready",
        message: `${payload.projectName || "Your project"} (${payload.exportType || "MP4"}) is ready to download.`,
        metadata: {
          event,
          projectName: payload.projectName,
          exportType: payload.exportType,
          downloadUrl: payload.downloadUrl
        }
      };
    case "payment_successful":
      return {
        type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
        title: "Payment confirmed",
        message: `We received your ${payload.amount || "payment"} for ${payload.planName || "your plan"}.`,
        metadata: {
          event,
          amount: payload.amount,
          planName: payload.planName,
          invoiceUrl: payload.invoiceUrl
        }
      };
    case "subscription_upgraded":
      return {
        type: NOTIFICATION_TYPES.SUBSCRIPTION_UPGRADED,
        title: `You're now on ${payload.planName || "Pro"}`,
        message: `Your plan was upgraded. Enjoy more credits and premium features.`,
        metadata: {
          event,
          planName: payload.planName,
          monthlyCredits: payload.monthlyCredits
        }
      };
    case "credits_80_percent":
      return {
        type: NOTIFICATION_TYPES.USAGE_WARNING_80,
        title: "Approaching monthly limit",
        message: `You've used ${payload.used ?? 0} of ${payload.limit ?? 0} credits this cycle.`,
        metadata: {
          event,
          used: payload.used,
          remaining: payload.remaining,
          limit: payload.limit,
          href: "/dashboard.html#subscription"
        }
      };
    case "credits_exhausted":
      return {
        type: NOTIFICATION_TYPES.USAGE_WARNING_100,
        title: "Monthly credits exhausted",
        message: `You've used all credits on your current plan. Upgrade to continue.`,
        metadata: {
          event,
          used: payload.used,
          remaining: payload.remaining,
          limit: payload.limit,
          href: "/dashboard.html#subscription"
        }
      };
    case "account_deletion_requested":
      return {
        type: NOTIFICATION_TYPES.ACCOUNT_DELETION_REQUESTED,
        title: "Account deletion scheduled",
        message: "Your account is scheduled for deletion. You can cancel from your dashboard.",
        metadata: {
          event,
          cancelUrl: payload.cancelUrl,
          cooldownDays: payload.cooldownDays
        }
      };
    case "account_deleted":
      return {
        type: NOTIFICATION_TYPES.ACCOUNT_DELETED,
        title: "Account deleted",
        message: "Your Cutup account has been permanently removed.",
        metadata: { event, cooldownDays: payload.cooldownDays }
      };
    case "ticket_created":
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_CREATED,
        title: `Ticket #${payload.ticketNumber || "\u2014"} created`,
        message: payload.subject ? `We received: ${payload.subject}` : "Your support request was received.",
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          subject: payload.subject,
          ticketUrl: payload.ticketUrl
        }
      };
    case "ticket_replied":
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
        title: `Reply on ticket #${payload.ticketNumber || "\u2014"}`,
        message: `${payload.agentName || "Support"} responded to your ticket.`,
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          agentName: payload.agentName,
          ticketUrl: payload.ticketUrl
        }
      };
    case "ticket_assigned":
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_ASSIGNED,
        title: `Ticket #${payload.ticketNumber || "\u2014"} assigned`,
        message: `${payload.agentName || "Support"} is handling your request.`,
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          agentName: payload.agentName,
          ticketUrl: payload.ticketUrl
        }
      };
    case "ticket_resolved":
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_RESOLVED,
        title: `Ticket #${payload.ticketNumber || "\u2014"} resolved`,
        message: payload.subject ? `"${payload.subject}" was marked resolved.` : "Your support ticket was resolved.",
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          subject: payload.subject,
          ticketUrl: payload.ticketUrl
        }
      };
    case "ticket_closed":
      return {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_CLOSED,
        title: `Ticket #${payload.ticketNumber || "\u2014"} closed`,
        message: payload.subject ? `"${payload.subject}" was closed.` : "Your support ticket was closed.",
        metadata: {
          event,
          ticketNumber: payload.ticketNumber,
          subject: payload.subject,
          ticketUrl: payload.ticketUrl
        }
      };
    case "security_notification":
      return {
        type: NOTIFICATION_TYPES.SECURITY_ALERT,
        title: String(payload.title || "Security alert"),
        message: String(payload.message || "A security event occurred on your account."),
        metadata: {
          event,
          actionUrl: payload.actionUrl,
          actionLabel: payload.actionLabel
        }
      };
    case "system_notification":
      return {
        type: NOTIFICATION_TYPES.SYSTEM_NOTIFICATION,
        title: String(payload.title || "Cutup update"),
        message: String(payload.message || "You have a new system notification."),
        metadata: {
          event,
          ctaUrl: payload.ctaUrl,
          ctaLabel: payload.ctaLabel
        }
      };
    default:
      return null;
  }
}

// services/notifications/createFromEvent.ts
async function createNotificationFromEvent(event, payload) {
  const draft = buildNotificationFromEvent(event, payload);
  if (!draft) return { ok: false, reason: "unsupported_event" };
  let userId = String(payload.userId || "").trim();
  if (!userId && payload.email) {
    const { getUserIdByEmail } = await import("../../api/billing-repository.js");
    userId = await getUserIdByEmail(String(payload.email).trim()) || "";
  }
  if (!userId) return { ok: false, reason: "missing_user_id" };
  return createNotification({
    userId,
    type: draft.type,
    title: draft.title,
    message: draft.message,
    metadata: { ...draft.metadata, email: payload.email || null }
  });
}

// services/notifications/getNotifications.ts
async function getNotifications(input) {
  const mod = await import("../../api/notifications-repository.js");
  const result = await mod.listNotificationsDb({
    userId: input.userId,
    page: input.page,
    limit: input.limit,
    filter: input.filter || "all"
  });
  if (!result.ok) return result;
  return {
    ...result,
    notifications: result.notifications.map((n) => ({
      ...n,
      icon: notificationIcon(n.type)
    }))
  };
}

// services/notifications/getUnreadCount.ts
async function getUnreadCount(userId) {
  const mod = await import("../../api/notifications-repository.js");
  return mod.countUnreadNotificationsDb(userId);
}

// services/notifications/markAsRead.ts
async function markAsRead(userId, notificationId) {
  const mod = await import("../../api/notifications-repository.js");
  return mod.markNotificationReadDb(userId, notificationId);
}

// services/notifications/markAllAsRead.ts
async function markAllAsRead(userId) {
  const mod = await import("../../api/notifications-repository.js");
  return mod.markAllNotificationsReadDb(userId);
}

async function markReadByTicket(userId, ticketNumber) {
  const mod = await import("../../api/notifications-repository.js");
  return mod.markNotificationsReadByTicketDb(userId, ticketNumber);
}

export {
  NOTIFICATION_TYPES,
  NotificationProvider,
  createNotification,
  createNotificationFromEvent,
  defaultNotificationProvider,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  markReadByTicket,
  notificationIcon
};
