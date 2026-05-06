from pathlib import Path

p = Path("website/adminha.html")
text = p.read_text(encoding="utf-8")
old = """      <div class="admin-header-brand">
        <div class="admin-logo-dot"></div>
        <motion>
          <h1>Cutup Admin</h1>
          <p id="adminIdentity">Loading admin identity...</p>
        </div>
      </div>"""

new = """      <div class="admin-header-brand">
        <img src="logo.svg" alt="" class="admin-header-logo" width="48" height="48" decoding="async" />
        <div class="admin-header-brand-text">
          <h1>Cutup Admin</h1>
          <p id="adminIdentity">Loading admin identity...</p>
        </div>
      </div>"""

old = old.replace("<motion>", "<div>").replace("motion", "div")
if "admin-logo-dot" not in text:
    raise SystemExit("logo dot not found")
text = text.replace(
    '<motion class="admin-logo-dot"></motion>'.replace("motion", "motion"),
    '<img src="logo.svg" alt="" class="admin-header-logo" width="48" height="48" decoding="async" />',
)
text = text.replace('<div class="admin-logo-dot"></div>', '<img src="logo.svg" alt="" class="admin-header-logo" width="48" height="48" decoding="async" />')
# wrap text block
text = text.replace(
    """      <div class="admin-header-brand">
        <img src="logo.svg" alt="" class="admin-header-logo" width="48" height="48" decoding="async" />
        <div>
          <h1>Cutup Admin</h1>""",
    """      <div class="admin-header-brand">
        <img src="logo.svg" alt="" class="admin-header-logo" width="48" height="48" decoding="async" />
        <div class="admin-header-brand-text">
          <h1>Cutup Admin</h1>""",
    1,
)
p.write_text(text, encoding="utf-8")
print("ok")
