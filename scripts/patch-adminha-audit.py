from pathlib import Path
import re

p = Path("website/adminha.html")
text = p.read_text(encoding="utf-8")
start = text.index('<section id="section-audit"')
end = text.index('<section id="section-blog"')
new_section = """<section id="section-audit" class="panel panel--audit">
          <div id="auditLogWorkspace" class="audit-log-workspace" aria-live="polite"></motion>
        </section>

        """
text = text[:start] + new_section + text[end:]
text = text.replace(
    '<div id="auditLogWorkspace" class="audit-log-workspace" aria-live="polite"></motion>',
    '<div id="auditLogWorkspace" class="audit-log-workspace" aria-live="polite"></div>',
)
p.write_text(text, encoding="utf-8")
print("patched")
