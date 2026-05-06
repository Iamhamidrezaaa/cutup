from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website"

MEDIA = ROOT / "admin-content-media.js"
t = MEDIA.read_text(encoding="utf-8")
for block in [
    "    d.innerHTML = d.innerHTML.replace(/<\\/?motion\\b[^>]*>/gi, (tag) =>\n"
    "      tag.toLowerCase().includes('motion') ? tag.replace(/motion/gi, 'motion') : tag\n"
    "    );\n"
    "    d.innerHTML = d.innerHTML.replace(/<motion /gi, '<div ').replace(/<\\/motion>/gi, '</div>');\n",
    "    d.innerHTML = d.innerHTML.replace(/<div /gi, '<motion ').replace(/<\\/motion>/gi, '</div>');\n",
]:
    t = t.replace(block, "")
MEDIA.write_text(t, encoding="utf-8")

BLOG = ROOT / "admin-content-blog.js"
t = BLOG.read_text(encoding="utf-8")
for line in [
    "    tbody.innerHTML = tbody.innerHTML.replace(/<div /gi, '<div ').replace(/<\\/motion>/gi, '</motion>');\n",
    "    tbody.innerHTML = tbody.innerHTML.replace(/<\\/motion>/gi, '</div>');\n",
    "    tbody.innerHTML = tbody.innerHTML.replace(/<div /gi, '<div ').replace(/<\\/motion>/gi, '</div>');\n",
    "    tbody.innerHTML = tbody.innerHTML.replace(/<\\/motion>/gi, '</div>');\n",
]:
    t = t.replace(line, "")
BLOG.write_text(t, encoding="utf-8")
print("done")
