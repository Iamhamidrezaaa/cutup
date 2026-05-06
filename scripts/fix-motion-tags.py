import re
from pathlib import Path

bad = "m" + "o" + "t" + "i" + "o" + "n"

for path in Path("website").glob("admin-content-*.js"):
    t = path.read_text(encoding="utf-8")
    t = re.sub(r"<" + bad + r"(\s|>)", r"<div\1", t, flags=re.I)
    t = re.sub(r"</" + bad + r">", r"</div>", t, flags=re.I)
    path.write_text(t, encoding="utf-8")
    print(path.name, re.search(bad, path.read_text(encoding="utf-8"), re.I) is not None)
