/**
 * Single global footer markup (ES module).
 */
export function renderFooter() {
  return (
    '<footer class="site-footer footer">' +
    '<div class="container">' +
    '<div class="footer-inner">' +
    '<div class="footer-brand logo">Cutup</div>' +
    '<nav class="footer-links" aria-label="Footer">' +
    '<a href="/#tool" class="footer-link">Subtitle generator</a>' +
    '<a href="/tools.html" class="footer-link">Tools</a>' +
    '<a href="/blog.html" class="footer-link">Blog</a>' +
    '<a href="/about.html" class="footer-link">About</a>' +
    '<a href="/privacy.html" class="footer-link">Privacy</a>' +
    '<a href="/contact.html" class="footer-link">Contact</a>' +
    '</nav>' +
    '<p class="footer-copy">© 2026 Cutup. All rights reserved.</p>' +
    '</div>' +
    '</div>' +
    '</footer>'
  );
}
