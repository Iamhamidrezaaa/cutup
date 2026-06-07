import * as React from 'react';
import { BRAND } from '../brand';

/** Global reset + mobile-only overrides — desktop appearance unchanged. */
export function EmailHeadStyles() {
  const css = `
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { border: 0; outline: none; text-decoration: none; display: block; max-width: 100%; height: auto; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 100%; }
    .email-container { width: 100% !important; max-width: ${BRAND.maxWidth} !important; }
    .email-hero-title { font-size: ${BRAND.heroTitleSize} !important; line-height: 1.15 !important; }
    .email-body-text { font-size: ${BRAND.bodySize} !important; line-height: 1.6 !important; }
    .email-meta-text { font-size: ${BRAND.metaSize} !important; line-height: 1.5 !important; }
    .email-word-break { word-break: break-word; overflow-wrap: anywhere; }
    .email-detail-row { width: 100% !important; table-layout: fixed !important; }
    .email-detail-label { font-size: ${BRAND.metaSize}; color: ${BRAND.textMuted}; vertical-align: top; width: 40%; padding-bottom: 4px; }
    .email-detail-value { font-size: 15px; font-weight: 600; color: ${BRAND.text}; text-align: right; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
    @media only screen and (max-width: 600px) {
      .email-body-wrap { padding: ${BRAND.padBodyMobile} !important; }
      .email-pad-x { padding-left: ${BRAND.padXMobile} !important; padding-right: ${BRAND.padXMobile} !important; }
      .email-card-outer { margin-left: ${BRAND.padXMobile} !important; margin-right: ${BRAND.padXMobile} !important; }
      .email-card-inner { padding: ${BRAND.cardPadMobile} !important; }
      .email-hero-title { font-size: ${BRAND.heroTitleSizeMobile} !important; line-height: 1.2 !important; }
      .email-hero-section { padding-top: 28px !important; padding-bottom: 24px !important; }
      .email-detail-row tr { display: block !important; width: 100% !important; }
      .email-detail-label,
      .email-detail-value {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        padding-bottom: 0 !important;
      }
      .email-detail-value { padding-top: 4px !important; padding-bottom: 12px !important; }
      .email-detail-wrap { padding: 12px !important; }
      .email-footer-links { font-size: 13px !important; }
    }
  `;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
