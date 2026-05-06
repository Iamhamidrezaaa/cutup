/**
 * Single global footer markup (ES module).
 */
export function renderFooter() {
  return (
    '<footer class="site-footer footer">' +
    '<div class="container">' +
    '<div class="footer-inner">' +
    '<a href="/" class="footer-brand logo" aria-label="Cutup home">' +
    '<img src="/logo-footer.svg" alt="Cutup logo" class="logo-icon footer-logo-icon" width="32" height="32" decoding="async" />' +
    '<span class="footer-brand-text">Cutup</span>' +
    '</a>' +
    '<nav class="footer-links" aria-label="Footer">' +
    '<a href="/blog.html" class="footer-link">Blog</a>' +
    '<a href="/faq.html" class="footer-link">FAQ</a>' +
    '<a href="/about.html" class="footer-link">About</a>' +
    '<a href="/privacy.html" class="footer-link">Privacy</a>' +
    '<a href="/terms.html" class="footer-link">Terms</a>' +
    '<a href="/contact.html" class="footer-link">Contact</a>' +
    '</nav>' +
    '<p class="footer-copy">© 2026 Cutup. All rights reserved.</p>' +
    '</div>' +
    '</div>' +
    '</footer>'
  );
}
