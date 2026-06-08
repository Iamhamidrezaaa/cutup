import * as React from 'react';
import { BRAND } from '../brand';

/** Typography + card helpers. Block padding lives inline on <td> via EmailBlock. */
export function EmailHeadStyles() {
  const css = `
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { border: 0; outline: none; text-decoration: none; display: block; max-width: 100%; height: auto; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; }
    .email-container { width: 100% !important; max-width: ${BRAND.maxWidth} !important; }
    .email-hero-title { font-size: ${BRAND.heroTitleSize} !important; line-height: 1.25 !important; }
    .email-body-text { font-size: ${BRAND.bodySize} !important; line-height: 1.65 !important; }
    .email-meta-text { font-size: ${BRAND.metaSize} !important; line-height: 1.5 !important; }
    .email-word-break { word-break: break-word; overflow-wrap: anywhere; }
    .email-detail-row { width: 100% !important; table-layout: fixed !important; }
    .email-detail-label { font-size: ${BRAND.metaSize}; color: ${BRAND.textMuted}; vertical-align: top; width: 40%; padding: 12px 0 8px; }
    .email-detail-value { font-size: 15px; font-weight: 600; color: ${BRAND.text}; text-align: right; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; padding: 12px 0 8px; }
    .email-card-body-text { margin: 0; font-size: ${BRAND.bodySize}; line-height: 1.7; color: ${BRAND.text}; }
    @media only screen and (max-width: 600px) {
      .email-hero-title { font-size: ${BRAND.heroTitleSizeMobile} !important; line-height: 1.3 !important; }
      .email-detail-row tr { display: block !important; width: 100% !important; }
      .email-detail-label,
      .email-detail-value {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        padding: 8px 0 4px !important;
      }
      .email-detail-value { padding-bottom: 12px !important; }
      .email-footer-links { font-size: 13px !important; }
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
