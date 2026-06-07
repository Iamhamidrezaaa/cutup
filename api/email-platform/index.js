// services/email/config.ts
var SITE_URL = (process.env.FRONTEND_URL || "https://cutup.shop").replace(/\/$/, "");
var EMAIL_CONFIG = {
  siteUrl: SITE_URL,
  dashboardUrl: `${SITE_URL}/dashboard.html`,
  supportEmail: "support@cutup.shop",
  senders: {
    default: "Cutup <noreply@cutup.shop>",
    billing: "Cutup Billing <billing@cutup.shop>",
    security: "Cutup Security <security@cutup.shop>",
    support: "Cutup Support <support@cutup.shop>"
  },
  replyTo: "support@cutup.shop"
};
function resolveSender(role = "default") {
  return EMAIL_CONFIG.senders[role] || EMAIL_CONFIG.senders.default;
}
function isResendConfigured() {
  const key = process.env.RESEND_API_KEY;
  return key != null && String(key).trim() !== "";
}
function isSmtpConfigured() {
  const required = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS"];
  return required.every((k) => {
    const v = process.env[k];
    return v != null && String(v).trim() !== "";
  });
}
function isEmailPlatformConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

// services/email/types.ts
var EMAIL_TEMPLATES = {
  WELCOME_EMAIL: "WELCOME_EMAIL",
  EXPORT_COMPLETED: "EXPORT_COMPLETED",
  PAYMENT_RECEIPT: "PAYMENT_RECEIPT",
  SUBSCRIPTION_UPGRADED: "SUBSCRIPTION_UPGRADED",
  USAGE_WARNING_80: "USAGE_WARNING_80",
  USAGE_WARNING_100: "USAGE_WARNING_100",
  ACCOUNT_DELETION_REQUESTED: "ACCOUNT_DELETION_REQUESTED",
  ACCOUNT_DELETION_COMPLETED: "ACCOUNT_DELETION_COMPLETED",
  SUPPORT_TICKET_CREATED: "SUPPORT_TICKET_CREATED",
  SUPPORT_TICKET_REPLY: "SUPPORT_TICKET_REPLY",
  SUPPORT_TICKET_CLOSED: "SUPPORT_TICKET_CLOSED",
  SECURITY_NOTIFICATION: "SECURITY_NOTIFICATION",
  SYSTEM_NOTIFICATION: "SYSTEM_NOTIFICATION"
};
var EMAIL_EVENTS = {
  USER_REGISTERED: "user_registered",
  EXPORT_COMPLETED: "export_completed",
  PAYMENT_SUCCESSFUL: "payment_successful",
  SUBSCRIPTION_UPGRADED: "subscription_upgraded",
  CREDITS_80_PERCENT: "credits_80_percent",
  CREDITS_EXHAUSTED: "credits_exhausted",
  ACCOUNT_DELETION_REQUESTED: "account_deletion_requested",
  ACCOUNT_DELETED: "account_deleted",
  TICKET_CREATED: "ticket_created",
  TICKET_REPLIED: "ticket_replied",
  TICKET_CLOSED: "ticket_closed"
};

// services/email/emailRegistry.ts
var sample = {
  firstName: "Alex",
  projectName: "Product Demo Reel",
  exportType: "MP4",
  exportDate: "Jun 2, 2026",
  downloadUrl: `${EMAIL_CONFIG.dashboardUrl}`,
  amount: "\u20AC19.00",
  planName: "Pro",
  paymentDate: "Jun 2, 2026",
  monthlyCredits: 50,
  used: 40,
  remaining: 10,
  limit: 50,
  ticketNumber: "1042",
  subject: "Export not downloading",
  createdAt: "Jun 2, 2026",
  agentName: "Sara",
  replyText: "Thanks for reaching out \u2014 we fixed the issue on your account.",
  cancelUrl: `${EMAIL_CONFIG.dashboardUrl}`,
  cooldownDays: 30,
  title: "New sign-in detected",
  message: "A new sign-in was detected on your Cutup account."
};
var EMAIL_REGISTRY = {
  [EMAIL_TEMPLATES.WELCOME_EMAIL]: {
    template: EMAIL_TEMPLATES.WELCOME_EMAIL,
    subject: () => "Welcome to Cutup",
    preview: () => "Welcome to Cutup \u2014 your AI video workspace",
    senderRole: "default",
    sampleData: { firstName: sample.firstName },
    event: EMAIL_EVENTS.USER_REGISTERED
  },
  [EMAIL_TEMPLATES.EXPORT_COMPLETED]: {
    template: EMAIL_TEMPLATES.EXPORT_COMPLETED,
    subject: () => "Your export is ready",
    preview: () => "Your export is ready",
    senderRole: "default",
    sampleData: {
      projectName: sample.projectName,
      exportType: sample.exportType,
      exportDate: sample.exportDate,
      downloadUrl: sample.downloadUrl
    },
    event: EMAIL_EVENTS.EXPORT_COMPLETED
  },
  [EMAIL_TEMPLATES.PAYMENT_RECEIPT]: {
    template: EMAIL_TEMPLATES.PAYMENT_RECEIPT,
    subject: () => "Payment received",
    preview: () => "Payment received \u2014 thank you",
    senderRole: "billing",
    sampleData: {
      firstName: sample.firstName,
      amount: sample.amount,
      planName: sample.planName,
      paymentDate: sample.paymentDate
    },
    event: EMAIL_EVENTS.PAYMENT_SUCCESSFUL
  },
  [EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED]: {
    template: EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED,
    subject: (d) => `Welcome to ${String(d.planName || "Pro")}`,
    preview: (d) => `Welcome to ${String(d.planName || "Pro")}`,
    senderRole: "billing",
    sampleData: {
      firstName: sample.firstName,
      planName: sample.planName,
      monthlyCredits: sample.monthlyCredits
    },
    event: EMAIL_EVENTS.SUBSCRIPTION_UPGRADED
  },
  [EMAIL_TEMPLATES.USAGE_WARNING_80]: {
    template: EMAIL_TEMPLATES.USAGE_WARNING_80,
    subject: () => "80% of monthly credits used",
    preview: () => "80% of monthly credits used",
    senderRole: "billing",
    sampleData: {
      firstName: sample.firstName,
      used: 40,
      remaining: 10,
      limit: 50
    },
    event: EMAIL_EVENTS.CREDITS_80_PERCENT
  },
  [EMAIL_TEMPLATES.USAGE_WARNING_100]: {
    template: EMAIL_TEMPLATES.USAGE_WARNING_100,
    subject: () => "100% of monthly credits used",
    preview: () => "100% of monthly credits used",
    senderRole: "billing",
    sampleData: {
      firstName: sample.firstName,
      used: 50,
      remaining: 0,
      limit: 50
    },
    event: EMAIL_EVENTS.CREDITS_EXHAUSTED
  },
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED]: {
    template: EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED,
    subject: () => "Your Cutup account deletion request",
    preview: () => "Your Cutup account deletion request",
    senderRole: "security",
    sampleData: {
      firstName: sample.firstName,
      cancelUrl: sample.cancelUrl,
      cooldownDays: sample.cooldownDays
    },
    event: EMAIL_EVENTS.ACCOUNT_DELETION_REQUESTED
  },
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED]: {
    template: EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED,
    subject: () => "Your Cutup account has been deleted",
    preview: () => "Your Cutup account has been deleted",
    senderRole: "security",
    sampleData: {
      firstName: sample.firstName,
      cooldownDays: sample.cooldownDays
    },
    event: EMAIL_EVENTS.ACCOUNT_DELETED
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED,
    subject: (d) => `Ticket #${String(d.ticketNumber || "0000")} received`,
    preview: (d) => `Ticket #${String(d.ticketNumber || "0000")} received`,
    senderRole: "support",
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject,
      createdAt: sample.createdAt
    },
    event: EMAIL_EVENTS.TICKET_CREATED
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY,
    subject: (d) => `Update on Ticket #${String(d.ticketNumber || "0000")}`,
    preview: (d) => `Update on Ticket #${String(d.ticketNumber || "0000")}`,
    senderRole: "support",
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      agentName: sample.agentName,
      replyText: sample.replyText
    },
    event: EMAIL_EVENTS.TICKET_REPLIED
  },
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED]: {
    template: EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED,
    subject: (d) => `Ticket #${String(d.ticketNumber || "0000")} resolved`,
    preview: (d) => `Ticket #${String(d.ticketNumber || "0000")} resolved`,
    senderRole: "support",
    sampleData: {
      firstName: sample.firstName,
      ticketNumber: sample.ticketNumber,
      subject: sample.subject
    },
    event: EMAIL_EVENTS.TICKET_CLOSED
  },
  [EMAIL_TEMPLATES.SECURITY_NOTIFICATION]: {
    template: EMAIL_TEMPLATES.SECURITY_NOTIFICATION,
    subject: (d) => String(d.title || "Security notification"),
    preview: (d) => String(d.title || "Security notification"),
    senderRole: "security",
    sampleData: {
      firstName: sample.firstName,
      title: sample.title,
      message: sample.message
    }
  },
  [EMAIL_TEMPLATES.SYSTEM_NOTIFICATION]: {
    template: EMAIL_TEMPLATES.SYSTEM_NOTIFICATION,
    subject: (d) => String(d.title || "Cutup update"),
    preview: (d) => String(d.title || "Cutup update"),
    senderRole: "default",
    sampleData: {
      firstName: sample.firstName,
      title: "Scheduled maintenance",
      message: "Cutup will undergo brief maintenance on Sunday at 02:00 UTC."
    }
  }
};
function getRegistryEntry(template) {
  const entry = EMAIL_REGISTRY[template];
  if (!entry) throw new Error(`Unknown email template: ${template}`);
  return entry;
}
function listAllTemplates() {
  return Object.values(EMAIL_REGISTRY);
}

// services/email/render.ts
import { render } from "@react-email/render";
import * as React from "react";

// emails/templates/WelcomeEmail.tsx
import { Section as Section4 } from "@react-email/components";

// emails/layouts/CutupLayout.tsx
import { Body, Container, Head, Html, Preview } from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

// emails/brand.ts
var BRAND = {
  primary: "#635BFF",
  primaryDark: "#4F46E5",
  text: "#111827",
  textMuted: "#6B7280",
  textSubtle: "#9CA3AF",
  background: "#FFFFFF",
  surface: "#F9FAFB",
  border: "#E5E7EB",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  radius: "12px",
  radiusLg: "16px",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
};
var SITE = {
  name: "Cutup",
  tagline: "AI Video Workspace",
  url: (process.env.FRONTEND_URL || "https://cutup.shop").replace(/\/$/, ""),
  supportEmail: "support@cutup.shop",
  privacyUrl: "https://cutup.shop/privacy",
  termsUrl: "https://cutup.shop/terms",
  dashboardUrl: "https://cutup.shop/dashboard.html"
};

// emails/components/EmailFooter.tsx
import { Link, Section, Text } from "@react-email/components";

// emails/components/EmailDivider.tsx
import { Hr } from "@react-email/components";
import { jsx } from "react/jsx-runtime";
function EmailDivider() {
  return /* @__PURE__ */ jsx(
    Hr,
    {
      style: {
        borderColor: BRAND.border,
        borderWidth: "1px",
        margin: "28px 0"
      }
    }
  );
}

// emails/components/EmailFooter.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function EmailFooter() {
  return /* @__PURE__ */ jsxs(Section, { style: { padding: "8px 24px 40px" }, children: [
    /* @__PURE__ */ jsx2(EmailDivider, {}),
    /* @__PURE__ */ jsxs(
      Text,
      {
        style: {
          margin: "0 0 12px",
          fontSize: "13px",
          lineHeight: "1.5",
          color: BRAND.textMuted,
          textAlign: "center"
        },
        children: [
          /* @__PURE__ */ jsx2(Link, { href: `mailto:${SITE.supportEmail}`, style: { color: BRAND.primary }, children: SITE.supportEmail }),
          " \xB7 ",
          /* @__PURE__ */ jsx2(Link, { href: SITE.privacyUrl, style: { color: BRAND.textMuted }, children: "Privacy Policy" }),
          " \xB7 ",
          /* @__PURE__ */ jsx2(Link, { href: SITE.termsUrl, style: { color: BRAND.textMuted }, children: "Terms" }),
          " \xB7 ",
          /* @__PURE__ */ jsx2(Link, { href: SITE.dashboardUrl, style: { color: BRAND.textMuted }, children: "Dashboard" })
        ]
      }
    ),
    /* @__PURE__ */ jsxs(
      Text,
      {
        style: {
          margin: 0,
          fontSize: "12px",
          color: BRAND.textSubtle,
          textAlign: "center"
        },
        children: [
          "\xA9 ",
          (/* @__PURE__ */ new Date()).getFullYear(),
          " Cutup \u2014 AI Video Workspace"
        ]
      }
    )
  ] });
}

// emails/components/EmailHeader.tsx
import { Img, Link as Link2, Section as Section2, Text as Text2 } from "@react-email/components";
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function EmailHeader() {
  return /* @__PURE__ */ jsxs2(Section2, { style: { padding: "32px 24px 8px", textAlign: "left" }, children: [
    /* @__PURE__ */ jsx3("table", { cellPadding: 0, cellSpacing: 0, style: { width: "100%" }, children: /* @__PURE__ */ jsxs2("tbody", { children: [
      /* @__PURE__ */ jsx3("tr", { children: /* @__PURE__ */ jsx3("td", { style: { verticalAlign: "middle" }, children: /* @__PURE__ */ jsx3(Link2, { href: SITE.url, style: { textDecoration: "none" }, children: /* @__PURE__ */ jsx3(
        Text2,
        {
          style: {
            margin: 0,
            fontSize: "22px",
            fontWeight: 800,
            color: BRAND.primary,
            letterSpacing: "-0.03em"
          },
          children: "Cutup"
        }
      ) }) }) }),
      /* @__PURE__ */ jsx3("tr", { children: /* @__PURE__ */ jsx3("td", { children: /* @__PURE__ */ jsx3(
        Text2,
        {
          style: {
            margin: "4px 0 0",
            fontSize: "13px",
            color: BRAND.textMuted,
            letterSpacing: "0.02em"
          },
          children: SITE.tagline
        }
      ) }) })
    ] }) }),
    /* @__PURE__ */ jsx3(
      Img,
      {
        src: `${SITE.url}/icons/icon128.png`,
        width: "0",
        height: "0",
        alt: "",
        style: { display: "none" }
      }
    )
  ] });
}

// emails/layouts/CutupLayout.tsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
var tailwindConfig = {
  theme: {
    extend: {
      colors: {
        brand: BRAND.primary,
        "brand-dark": BRAND.primaryDark
      }
    }
  }
};
function CutupLayout({ preview, children }) {
  return /* @__PURE__ */ jsxs3(Html, { lang: "en", children: [
    /* @__PURE__ */ jsxs3(Head, { children: [
      /* @__PURE__ */ jsx4("meta", { name: "color-scheme", content: "light dark" }),
      /* @__PURE__ */ jsx4("meta", { name: "supported-color-schemes", content: "light dark" })
    ] }),
    /* @__PURE__ */ jsx4(Preview, { children: preview }),
    /* @__PURE__ */ jsx4(Tailwind, { config: tailwindConfig, children: /* @__PURE__ */ jsx4(
      Body,
      {
        className: "m-0 p-0",
        style: {
          backgroundColor: BRAND.background,
          fontFamily: BRAND.fontFamily,
          WebkitFontSmoothing: "antialiased"
        },
        children: /* @__PURE__ */ jsxs3(
          Container,
          {
            className: "mx-auto",
            style: {
              maxWidth: "560px",
              margin: "0 auto",
              backgroundColor: BRAND.background
            },
            children: [
              /* @__PURE__ */ jsx4(EmailHeader, {}),
              /* @__PURE__ */ jsx4(Container, { style: { padding: "8px 24px 16px" }, children }),
              /* @__PURE__ */ jsx4(EmailFooter, {})
            ]
          }
        )
      }
    ) })
  ] });
}

// emails/components/EmailButton.tsx
import { Button } from "@react-email/components";
import { jsx as jsx5 } from "react/jsx-runtime";
function EmailButton({ href, children, variant = "primary" }) {
  const isPrimary = variant === "primary";
  return /* @__PURE__ */ jsx5(
    Button,
    {
      href,
      style: {
        display: "inline-block",
        padding: "14px 28px",
        borderRadius: BRAND.radius,
        fontSize: "15px",
        fontWeight: 600,
        textDecoration: "none",
        textAlign: "center",
        backgroundColor: isPrimary ? BRAND.primary : BRAND.surface,
        color: isPrimary ? "#FFFFFF" : BRAND.text,
        border: isPrimary ? "none" : `1px solid ${BRAND.border}`,
        boxShadow: isPrimary ? "0 1px 2px rgba(99,91,255,0.24)" : "none"
      },
      children
    }
  );
}

// emails/components/EmailCard.tsx
import { Section as Section3 } from "@react-email/components";
import { jsx as jsx6 } from "react/jsx-runtime";
function EmailCard({ children }) {
  return /* @__PURE__ */ jsx6(
    Section3,
    {
      style: {
        backgroundColor: BRAND.surface,
        borderRadius: BRAND.radiusLg,
        border: `1px solid ${BRAND.border}`,
        padding: "20px 24px",
        margin: "0 0 24px"
      },
      children
    }
  );
}

// emails/components/EmailHeading.tsx
import { Heading } from "@react-email/components";
import { jsx as jsx7 } from "react/jsx-runtime";
function EmailHeading({ children, as = "h1" }) {
  const size = as === "h1" ? "28px" : as === "h2" ? "22px" : "18px";
  return /* @__PURE__ */ jsx7(
    Heading,
    {
      as,
      style: {
        margin: "0 0 16px",
        fontSize: size,
        lineHeight: "1.25",
        fontWeight: 700,
        color: BRAND.text,
        letterSpacing: "-0.02em"
      },
      children
    }
  );
}

// emails/components/EmailText.tsx
import { Text as Text3 } from "@react-email/components";
import { jsx as jsx8 } from "react/jsx-runtime";
function EmailText({ children, muted, small, style }) {
  return /* @__PURE__ */ jsx8(
    Text3,
    {
      style: {
        margin: "0 0 16px",
        fontSize: small ? "14px" : "16px",
        lineHeight: "1.6",
        color: muted ? BRAND.textMuted : BRAND.text,
        ...style
      },
      children
    }
  );
}

// emails/templates/WelcomeEmail.tsx
import { jsx as jsx9, jsxs as jsxs4 } from "react/jsx-runtime";
function WelcomeEmail({ firstName = "there" }) {
  const name = String(firstName).trim() || "there";
  return /* @__PURE__ */ jsxs4(CutupLayout, { preview: "Welcome to Cutup \u2014 your AI video workspace", children: [
    /* @__PURE__ */ jsx9(EmailHeading, { children: "Welcome to Cutup" }),
    /* @__PURE__ */ jsxs4(EmailText, { children: [
      "Hi ",
      name,
      ", thanks for joining Cutup. Your AI video workspace is ready \u2014 transcribe, translate, summarize, and export videos in one place."
    ] }),
    /* @__PURE__ */ jsx9(Section4, { style: { margin: "28px 0" }, children: /* @__PURE__ */ jsx9(EmailButton, { href: SITE.dashboardUrl, children: "Open Dashboard" }) }),
    /* @__PURE__ */ jsxs4(EmailText, { muted: true, small: true, children: [
      "Questions? Reply to this email or contact ",
      SITE.supportEmail,
      "."
    ] })
  ] });
}

// emails/templates/ExportCompleted.tsx
import { Section as Section5 } from "@react-email/components";
import { jsx as jsx10, jsxs as jsxs5 } from "react/jsx-runtime";
function ExportCompleted({
  projectName = "Your project",
  exportType = "MP4",
  exportDate,
  downloadUrl
}) {
  const dateLabel = exportDate || (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { dateStyle: "medium" });
  const download = downloadUrl || SITE.dashboardUrl;
  return /* @__PURE__ */ jsxs5(CutupLayout, { preview: "Your export is ready", children: [
    /* @__PURE__ */ jsx10(EmailHeading, { children: "Your export is ready" }),
    /* @__PURE__ */ jsxs5(EmailText, { children: [
      "Your ",
      exportType,
      " export has finished processing and is ready to download."
    ] }),
    /* @__PURE__ */ jsxs5(EmailCard, { children: [
      /* @__PURE__ */ jsxs5(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx10("strong", { children: "Project:" }),
        " ",
        projectName
      ] }),
      /* @__PURE__ */ jsxs5(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx10("strong", { children: "Export type:" }),
        " ",
        exportType
      ] }),
      /* @__PURE__ */ jsxs5(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx10("strong", { children: "Date:" }),
        " ",
        dateLabel
      ] })
    ] }),
    /* @__PURE__ */ jsx10(Section5, { style: { margin: "8px 0 20px" }, children: /* @__PURE__ */ jsx10(EmailButton, { href: download, children: "Download Export" }) }),
    /* @__PURE__ */ jsx10(Section5, { children: /* @__PURE__ */ jsx10(EmailButton, { href: SITE.dashboardUrl, variant: "secondary", children: "Open Dashboard" }) })
  ] });
}

// emails/templates/PaymentReceipt.tsx
import { Section as Section6 } from "@react-email/components";
import { jsx as jsx11, jsxs as jsxs6 } from "react/jsx-runtime";
function PaymentReceipt({
  firstName = "there",
  amount = "\u2014",
  planName = "Cutup",
  paymentDate,
  invoiceUrl
}) {
  const dateLabel = paymentDate || (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { dateStyle: "medium" });
  return /* @__PURE__ */ jsxs6(CutupLayout, { preview: "Payment received \u2014 thank you", children: [
    /* @__PURE__ */ jsx11(EmailHeading, { children: "Payment received" }),
    /* @__PURE__ */ jsxs6(EmailText, { children: [
      "Hi ",
      firstName,
      ", we received your payment. Thank you for supporting Cutup."
    ] }),
    /* @__PURE__ */ jsxs6(EmailCard, { children: [
      /* @__PURE__ */ jsxs6(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx11("strong", { children: "Plan:" }),
        " ",
        planName
      ] }),
      /* @__PURE__ */ jsxs6(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx11("strong", { children: "Amount:" }),
        " ",
        amount
      ] }),
      /* @__PURE__ */ jsxs6(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx11("strong", { children: "Date:" }),
        " ",
        dateLabel
      ] })
    ] }),
    invoiceUrl ? /* @__PURE__ */ jsx11(Section6, { style: { margin: "20px 0" }, children: /* @__PURE__ */ jsx11(EmailButton, { href: invoiceUrl, children: "View Invoice" }) }) : null,
    /* @__PURE__ */ jsxs6(EmailText, { muted: true, small: true, children: [
      "Billing questions? Contact ",
      SITE.supportEmail,
      "."
    ] })
  ] });
}

// emails/templates/SubscriptionUpgraded.tsx
import { Section as Section7 } from "@react-email/components";
import { jsx as jsx12, jsxs as jsxs7 } from "react/jsx-runtime";
function SubscriptionUpgraded({
  firstName = "there",
  planName = "Pro",
  monthlyCredits
}) {
  return /* @__PURE__ */ jsxs7(CutupLayout, { preview: `Welcome to ${planName}`, children: [
    /* @__PURE__ */ jsxs7(EmailHeading, { children: [
      "Welcome to ",
      planName
    ] }),
    /* @__PURE__ */ jsxs7(EmailText, { children: [
      "Hi ",
      firstName,
      ", your Cutup plan has been upgraded. You now have access to more processing power and premium features."
    ] }),
    /* @__PURE__ */ jsxs7(EmailCard, { children: [
      /* @__PURE__ */ jsxs7(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx12("strong", { children: "Plan:" }),
        " ",
        planName
      ] }),
      monthlyCredits != null ? /* @__PURE__ */ jsxs7(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx12("strong", { children: "Monthly credits:" }),
        " ",
        monthlyCredits
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx12(Section7, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx12(EmailButton, { href: SITE.dashboardUrl, children: "Start Creating" }) })
  ] });
}

// emails/templates/UsageWarning80.tsx
import { Section as Section8 } from "@react-email/components";
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function UsageWarning80({
  firstName = "there",
  used = 0,
  remaining = 0,
  limit = 0,
  upgradeUrl
}) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;
  return /* @__PURE__ */ jsxs8(CutupLayout, { preview: "80% of monthly credits used", children: [
    /* @__PURE__ */ jsx13(EmailHeading, { children: "80% of monthly credits used" }),
    /* @__PURE__ */ jsxs8(EmailText, { children: [
      "Hi ",
      firstName,
      ", you've used most of your monthly processing credits. Consider upgrading to avoid interruptions."
    ] }),
    /* @__PURE__ */ jsxs8(EmailCard, { children: [
      /* @__PURE__ */ jsxs8(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx13("strong", { children: "Used:" }),
        " ",
        used
      ] }),
      /* @__PURE__ */ jsxs8(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx13("strong", { children: "Remaining:" }),
        " ",
        remaining
      ] }),
      /* @__PURE__ */ jsxs8(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx13("strong", { children: "Limit:" }),
        " ",
        limit
      ] })
    ] }),
    /* @__PURE__ */ jsx13(Section8, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx13(EmailButton, { href: upgrade, children: "Upgrade Plan" }) }),
    /* @__PURE__ */ jsx13(EmailText, { muted: true, small: true, style: { color: BRAND.warning }, children: "You're approaching your monthly limit." })
  ] });
}

// emails/templates/UsageWarning100.tsx
import { Section as Section9 } from "@react-email/components";
import { jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function UsageWarning100({
  firstName = "there",
  used = 0,
  remaining = 0,
  limit = 0,
  upgradeUrl
}) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;
  return /* @__PURE__ */ jsxs9(CutupLayout, { preview: "100% of monthly credits used", children: [
    /* @__PURE__ */ jsx14(EmailHeading, { children: "100% of monthly credits used" }),
    /* @__PURE__ */ jsxs9(EmailText, { children: [
      "Hi ",
      firstName,
      ", you've used all monthly processing credits on your current plan. Upgrade to continue generating outputs."
    ] }),
    /* @__PURE__ */ jsxs9(EmailCard, { children: [
      /* @__PURE__ */ jsxs9(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx14("strong", { children: "Used:" }),
        " ",
        used
      ] }),
      /* @__PURE__ */ jsxs9(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx14("strong", { children: "Remaining:" }),
        " ",
        remaining
      ] }),
      /* @__PURE__ */ jsxs9(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx14("strong", { children: "Limit:" }),
        " ",
        limit
      ] })
    ] }),
    /* @__PURE__ */ jsx14(Section9, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx14(EmailButton, { href: upgrade, children: "Upgrade Plan" }) }),
    /* @__PURE__ */ jsx14(EmailText, { muted: true, small: true, style: { color: BRAND.danger }, children: "Processing is paused until your cycle renews or you upgrade." })
  ] });
}

// emails/templates/AccountDeletionRequested.tsx
import { Section as Section10 } from "@react-email/components";
import { jsx as jsx15, jsxs as jsxs10 } from "react/jsx-runtime";
function AccountDeletionRequested({
  firstName = "there",
  cancelUrl,
  confirmDeletionUrl,
  cooldownDays = 30
}) {
  const cancel = cancelUrl || SITE.dashboardUrl;
  return /* @__PURE__ */ jsxs10(CutupLayout, { preview: "Your Cutup account deletion request", children: [
    /* @__PURE__ */ jsx15(EmailHeading, { children: "Your Cutup account deletion request" }),
    /* @__PURE__ */ jsxs10(EmailText, { children: [
      "Hi ",
      firstName,
      ", we received a request to delete your Cutup account. Your account is scheduled for deletion."
    ] }),
    /* @__PURE__ */ jsxs10(EmailCard, { children: [
      /* @__PURE__ */ jsx15(EmailText, { style: { margin: "0 0 12px" }, children: "\u2022 Your account will be permanently deleted once confirmed." }),
      /* @__PURE__ */ jsxs10(EmailText, { style: { margin: "0 0 12px" }, children: [
        "\u2022 You cannot create another account using the same email for",
        " ",
        /* @__PURE__ */ jsxs10("strong", { children: [
          cooldownDays,
          " days"
        ] }),
        " after deletion."
      ] }),
      /* @__PURE__ */ jsx15(EmailText, { style: { margin: 0 }, children: "\u2022 If you did not request this, contact support immediately." })
    ] }),
    /* @__PURE__ */ jsx15(Section10, { style: { margin: "24px 0 16px" }, children: /* @__PURE__ */ jsx15(EmailButton, { href: cancel, children: "Cancel Deletion" }) }),
    confirmDeletionUrl ? /* @__PURE__ */ jsx15(Section10, { style: { margin: "0 0 16px" }, children: /* @__PURE__ */ jsx15(EmailButton, { href: confirmDeletionUrl, variant: "secondary", children: "Confirm Deletion" }) }) : null,
    /* @__PURE__ */ jsxs10(EmailText, { muted: true, small: true, style: { color: BRAND.danger }, children: [
      "Didn't request this? Email",
      " ",
      /* @__PURE__ */ jsx15("a", { href: `mailto:${SITE.supportEmail}`, style: { color: BRAND.primary }, children: SITE.supportEmail }),
      " ",
      "immediately."
    ] })
  ] });
}

// emails/templates/AccountDeletionCompleted.tsx
import { Section as Section11 } from "@react-email/components";
import { jsx as jsx16, jsxs as jsxs11 } from "react/jsx-runtime";
function AccountDeletionCompleted({
  firstName = "there",
  cooldownDays = 30
}) {
  return /* @__PURE__ */ jsxs11(CutupLayout, { preview: "Your Cutup account has been deleted", children: [
    /* @__PURE__ */ jsx16(EmailHeading, { children: "Your Cutup account has been deleted" }),
    /* @__PURE__ */ jsxs11(EmailText, { children: [
      "Hi ",
      firstName,
      ", your Cutup account and associated data have been permanently removed."
    ] }),
    /* @__PURE__ */ jsxs11(EmailText, { children: [
      "\u2022 Your account is no longer available.",
      /* @__PURE__ */ jsx16("br", {}),
      "\u2022 The same email address is locked for ",
      /* @__PURE__ */ jsxs11("strong", { children: [
        cooldownDays,
        " days"
      ] }),
      " and cannot be used to register a new account during this period."
    ] }),
    /* @__PURE__ */ jsx16(Section11, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx16(EmailButton, { href: `mailto:${SITE.supportEmail}`, variant: "secondary", children: "Contact Support" }) }),
    /* @__PURE__ */ jsxs11(EmailText, { muted: true, small: true, children: [
      "If you believe this was a mistake, contact ",
      SITE.supportEmail,
      " as soon as possible."
    ] })
  ] });
}

// emails/templates/SupportTicketCreated.tsx
import { Section as Section12 } from "@react-email/components";
import { jsx as jsx17, jsxs as jsxs12 } from "react/jsx-runtime";
function SupportTicketCreated({
  firstName = "there",
  ticketNumber = "0000",
  subject = "Support request",
  createdAt,
  ticketUrl
}) {
  const dateLabel = createdAt || (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { dateStyle: "medium" });
  const url = ticketUrl || SITE.dashboardUrl;
  return /* @__PURE__ */ jsxs12(CutupLayout, { preview: `Ticket #${ticketNumber} received`, children: [
    /* @__PURE__ */ jsxs12(EmailHeading, { children: [
      "Ticket #",
      ticketNumber,
      " received"
    ] }),
    /* @__PURE__ */ jsxs12(EmailText, { children: [
      "Hi ",
      firstName,
      ", we've received your support request and will respond shortly."
    ] }),
    /* @__PURE__ */ jsxs12(EmailCard, { children: [
      /* @__PURE__ */ jsxs12(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx17("strong", { children: "Ticket:" }),
        " #",
        ticketNumber
      ] }),
      /* @__PURE__ */ jsxs12(EmailText, { style: { margin: "0 0 8px" }, children: [
        /* @__PURE__ */ jsx17("strong", { children: "Subject:" }),
        " ",
        subject
      ] }),
      /* @__PURE__ */ jsxs12(EmailText, { style: { margin: 0 }, children: [
        /* @__PURE__ */ jsx17("strong", { children: "Created:" }),
        " ",
        dateLabel
      ] })
    ] }),
    /* @__PURE__ */ jsx17(Section12, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx17(EmailButton, { href: url, children: "View Ticket" }) })
  ] });
}

// emails/templates/SupportTicketReply.tsx
import { Section as Section13 } from "@react-email/components";
import { jsx as jsx18, jsxs as jsxs13 } from "react/jsx-runtime";
function SupportTicketReply({
  firstName = "there",
  ticketNumber = "0000",
  agentName = "Cutup Support",
  replyText = "",
  ticketUrl
}) {
  const url = ticketUrl || SITE.dashboardUrl;
  return /* @__PURE__ */ jsxs13(CutupLayout, { preview: `Update on Ticket #${ticketNumber}`, children: [
    /* @__PURE__ */ jsxs13(EmailHeading, { children: [
      "Update on Ticket #",
      ticketNumber
    ] }),
    /* @__PURE__ */ jsxs13(EmailText, { children: [
      "Hi ",
      firstName,
      ", ",
      agentName,
      " replied to your support ticket."
    ] }),
    /* @__PURE__ */ jsxs13(EmailCard, { children: [
      /* @__PURE__ */ jsxs13(EmailText, { style: { margin: "0 0 12px", fontSize: "14px", color: "#6B7280" }, children: [
        /* @__PURE__ */ jsx18("strong", { children: agentName }),
        " wrote:"
      ] }),
      /* @__PURE__ */ jsx18(EmailText, { style: { margin: 0, whiteSpace: "pre-wrap" }, children: replyText || "\u2014" })
    ] }),
    /* @__PURE__ */ jsx18(Section13, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx18(EmailButton, { href: url, children: "View Ticket" }) })
  ] });
}

// emails/templates/SupportTicketClosed.tsx
import { Section as Section14 } from "@react-email/components";
import { jsx as jsx19, jsxs as jsxs14 } from "react/jsx-runtime";
function SupportTicketClosed({
  firstName = "there",
  ticketNumber = "0000",
  subject = "Support request",
  ratingUrl
}) {
  const rate = ratingUrl || SITE.dashboardUrl;
  return /* @__PURE__ */ jsxs14(CutupLayout, { preview: `Ticket #${ticketNumber} resolved`, children: [
    /* @__PURE__ */ jsxs14(EmailHeading, { children: [
      "Ticket #",
      ticketNumber,
      " resolved"
    ] }),
    /* @__PURE__ */ jsxs14(EmailText, { children: [
      "Hi ",
      firstName,
      ', your support ticket "',
      subject,
      '" has been marked as resolved.'
    ] }),
    /* @__PURE__ */ jsx19(EmailText, { children: "How was your experience? Your feedback helps us improve Cutup." }),
    /* @__PURE__ */ jsx19(Section14, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx19(EmailButton, { href: rate, children: "Rate Support" }) })
  ] });
}

// emails/templates/SecurityNotification.tsx
import { Section as Section15 } from "@react-email/components";
import { jsx as jsx20, jsxs as jsxs15 } from "react/jsx-runtime";
function SecurityNotification({
  firstName = "there",
  title = "Security notification",
  message = "A security-related event occurred on your Cutup account.",
  actionUrl,
  actionLabel = "Review Account"
}) {
  return /* @__PURE__ */ jsxs15(CutupLayout, { preview: title, children: [
    /* @__PURE__ */ jsx20(EmailHeading, { children: title }),
    /* @__PURE__ */ jsxs15(EmailText, { children: [
      "Hi ",
      firstName,
      ","
    ] }),
    /* @__PURE__ */ jsx20(EmailCard, { children: /* @__PURE__ */ jsx20(EmailText, { style: { margin: 0 }, children: message }) }),
    actionUrl ? /* @__PURE__ */ jsx20(Section15, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx20(EmailButton, { href: actionUrl, children: actionLabel }) }) : null,
    /* @__PURE__ */ jsxs15(EmailText, { muted: true, small: true, style: { color: BRAND.danger }, children: [
      "If this wasn't you, contact ",
      SITE.supportEmail,
      " immediately."
    ] })
  ] });
}

// emails/templates/SystemNotification.tsx
import { Section as Section16 } from "@react-email/components";
import { jsx as jsx21, jsxs as jsxs16 } from "react/jsx-runtime";
function SystemNotification({
  firstName = "there",
  title = "Cutup update",
  message = "",
  ctaUrl,
  ctaLabel = "Open Dashboard"
}) {
  return /* @__PURE__ */ jsxs16(CutupLayout, { preview: title, children: [
    /* @__PURE__ */ jsx21(EmailHeading, { children: title }),
    /* @__PURE__ */ jsxs16(EmailText, { children: [
      "Hi ",
      firstName,
      ","
    ] }),
    /* @__PURE__ */ jsx21(EmailCard, { children: /* @__PURE__ */ jsx21(EmailText, { style: { margin: 0, whiteSpace: "pre-wrap" }, children: message || "\u2014" }) }),
    /* @__PURE__ */ jsx21(Section16, { style: { margin: "24px 0" }, children: /* @__PURE__ */ jsx21(EmailButton, { href: ctaUrl || SITE.dashboardUrl, children: ctaLabel }) })
  ] });
}

// services/email/render.ts
var TEMPLATE_COMPONENTS = {
  [EMAIL_TEMPLATES.WELCOME_EMAIL]: WelcomeEmail,
  [EMAIL_TEMPLATES.EXPORT_COMPLETED]: ExportCompleted,
  [EMAIL_TEMPLATES.PAYMENT_RECEIPT]: PaymentReceipt,
  [EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED]: SubscriptionUpgraded,
  [EMAIL_TEMPLATES.USAGE_WARNING_80]: UsageWarning80,
  [EMAIL_TEMPLATES.USAGE_WARNING_100]: UsageWarning100,
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED]: AccountDeletionRequested,
  [EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED]: AccountDeletionCompleted,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED]: SupportTicketCreated,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY]: SupportTicketReply,
  [EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED]: SupportTicketClosed,
  [EMAIL_TEMPLATES.SECURITY_NOTIFICATION]: SecurityNotification,
  [EMAIL_TEMPLATES.SYSTEM_NOTIFICATION]: SystemNotification
};
function stripHtml(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function renderEmailTemplate(template, data = {}) {
  const entry = getRegistryEntry(template);
  const Component = TEMPLATE_COMPONENTS[template];
  if (!Component) throw new Error(`No React component for template: ${template}`);
  const element = React.createElement(Component, data);
  const html = render(element, { pretty: false });
  const subject = entry.subject(data);
  const preview = entry.preview(data);
  return {
    subject,
    html,
    text: stripHtml(html),
    preview
  };
}

// services/email/providers/resend.ts
async function sendViaResend(input) {
  if (!isResendConfigured()) {
    return { sent: false, skipped: true };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const payload = {
      from: input.from,
      to: [input.to],
      subject: input.subject.slice(0, 200),
      html: input.html,
      text: input.text,
      reply_to: input.replyTo || EMAIL_CONFIG.replyTo
    };
    if (input.tags?.length) {
      payload.tags = input.tags;
    }
    const result = await resend.emails.send(payload);
    if (result.error) {
      return { sent: false, error: result.error.message || String(result.error) };
    }
    return { sent: true, messageId: result.data?.id };
  } catch (err) {
    return { sent: false, error: err?.message || String(err) };
  }
}

// services/email/providers/smtp.ts
import nodemailer from "nodemailer";
var transporterPromise = null;
function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporterPromise;
}
async function sendViaSmtp(input) {
  const transport = getTransporter();
  if (!transport) return { sent: false, skipped: true };
  try {
    const info = await transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject.slice(0, 200),
      html: input.html,
      text: input.text,
      replyTo: input.replyTo
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, error: err?.message || String(err) };
  }
}

// services/email/sendEmail.ts
async function sendEmail(input) {
  const { template, recipient, data = {}, senderRole, tags } = input;
  const to = String(recipient || "").trim();
  if (!to) {
    return { sent: false, error: "missing_recipient", template };
  }
  if (!isEmailPlatformConfigured()) {
    console.warn("[email-platform] transport not configured; skip send", { template, to });
    return { sent: false, skipped: true, template };
  }
  const entry = getRegistryEntry(template);
  const rendered = renderEmailTemplate(template, data);
  const from = resolveSender(senderRole || entry.senderRole);
  const providerInput = {
    from,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: tags?.map((t) => ({ name: "cutup", value: t }))
  };
  let result;
  let provider = "smtp";
  if (isResendConfigured()) {
    provider = "resend";
    result = await sendViaResend(providerInput);
    if (!result.sent && !result.skipped) {
      console.warn("[email-platform] Resend failed, trying SMTP fallback", result.error);
      result = await sendViaSmtp(providerInput);
      provider = "smtp";
    }
  } else {
    result = await sendViaSmtp(providerInput);
  }
  if (result.sent) {
    console.log("[email-platform] sent", { template, to, provider, messageId: result.messageId });
  } else if (!result.skipped) {
    console.error("[email-platform] failed", { template, to, error: result.error });
  }
  return {
    sent: Boolean(result.sent),
    skipped: result.skipped,
    error: result.error,
    provider: result.sent ? provider : void 0,
    messageId: result.messageId,
    template
  };
}

// services/email/emailEvents.ts
var handlers = /* @__PURE__ */ new Map();
var EVENT_TEMPLATE_MAP = {
  [EMAIL_EVENTS.USER_REGISTERED]: EMAIL_TEMPLATES.WELCOME_EMAIL,
  [EMAIL_EVENTS.EXPORT_COMPLETED]: EMAIL_TEMPLATES.EXPORT_COMPLETED,
  [EMAIL_EVENTS.PAYMENT_SUCCESSFUL]: EMAIL_TEMPLATES.PAYMENT_RECEIPT,
  [EMAIL_EVENTS.SUBSCRIPTION_UPGRADED]: EMAIL_TEMPLATES.SUBSCRIPTION_UPGRADED,
  [EMAIL_EVENTS.CREDITS_80_PERCENT]: EMAIL_TEMPLATES.USAGE_WARNING_80,
  [EMAIL_EVENTS.CREDITS_EXHAUSTED]: EMAIL_TEMPLATES.USAGE_WARNING_100,
  [EMAIL_EVENTS.ACCOUNT_DELETION_REQUESTED]: EMAIL_TEMPLATES.ACCOUNT_DELETION_REQUESTED,
  [EMAIL_EVENTS.ACCOUNT_DELETED]: EMAIL_TEMPLATES.ACCOUNT_DELETION_COMPLETED,
  [EMAIL_EVENTS.TICKET_CREATED]: EMAIL_TEMPLATES.SUPPORT_TICKET_CREATED,
  [EMAIL_EVENTS.TICKET_REPLIED]: EMAIL_TEMPLATES.SUPPORT_TICKET_REPLY,
  [EMAIL_EVENTS.TICKET_CLOSED]: EMAIL_TEMPLATES.SUPPORT_TICKET_CLOSED
};
function onEmailEvent(event, handler) {
  const list = handlers.get(event) || [];
  list.push(handler);
  handlers.set(event, list);
}
async function emitEmailEvent(event, payload) {
  const results = [];
  const template = EVENT_TEMPLATE_MAP[event];
  if (template && payload.email) {
    const { email, firstName, ...rest } = payload;
    const data = { firstName, ...rest };
    const out = await sendEmail({ template, recipient: email, data });
    results.push(out);
  }
  const customHandlers = handlers.get(event) || [];
  for (const handler of customHandlers) {
    try {
      await handler(payload);
    } catch (err) {
      console.error("[email-events] handler failed", event, err);
    }
  }
  return { ok: results.every((r) => r.sent || r.skipped), results };
}
function registerDefaultEmailEventHandlers() {
  for (const entry of Object.values(EMAIL_REGISTRY)) {
    if (!entry.event) continue;
    onEmailEvent(entry.event, async () => {
    });
  }
}
export {
  EMAIL_CONFIG,
  EMAIL_EVENTS,
  EMAIL_REGISTRY,
  EMAIL_TEMPLATES,
  emitEmailEvent,
  getRegistryEntry,
  isEmailPlatformConfigured,
  isResendConfigured,
  isSmtpConfigured,
  listAllTemplates,
  onEmailEvent,
  registerDefaultEmailEventHandlers,
  renderEmailTemplate,
  sendEmail
};
