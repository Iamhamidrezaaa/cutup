import * as React from 'react';
import { BRAND } from '../brand';

/** Global reset + responsive rules for Gmail / Outlook / Apple Mail. */
export function EmailHeadStyles() {
  const css = `
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { border: 0; outline: none; text-decoration: none; display: block; max-width: 100%; height: auto; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; }
    .email-container { width: 100% !important; max-width: ${BRAND.maxWidth} !important; }
    .email-hero-title { font-size: ${BRAND.heroTitleSize} !important; line-height: 1.2 !important; }
    .email-body-text { font-size: ${BRAND.bodySize} !important; line-height: 1.5 !important; }
    .email-word-break { word-break: break-word; overflow-wrap: anywhere; }
    @media only screen and (max-width: 600px) {
      .email-hero-title { font-size: 28px !important; line-height: 1.2 !important; }
      .email-pad-x { padding-left: 16px !important; padding-right: 16px !important; }
      .email-card-inner { padding: 14px !important; }
      .email-card-outer { margin-left: 16px !important; margin-right: 16px !important; }
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
