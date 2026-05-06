from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website"

def catch_block(label):
    return f"""    }} catch (e) {{
      if (window.CutupContentStudio?.isSetupError?.(e)) {{
        window.CutupContentStudio.renderSetupState(el, {{
          missingTables: e.payload?.missingTables,
          onRetry: () => load()
        }});
        return;
      }}
      el.innerHTML = `<div class="cs-empty"><h3>Could not load {label}</h3><p>${{esc(window.CutupContentStudio?.friendlyApiMessage?.({{ message: e.message }}) || 'Please try again.')}}</p></div>`;
    }}
"""

for name, label in [
    ("admin-content-pages.js", "pages"),
    ("admin-content-blog.js", "blog"),
    ("admin-content-media.js", "library"),
]:
    p = ROOT / name
    t = p.read_text(encoding="utf-8")
    i = t.find("async function load()")
    j = t.find("} catch (e) {", i)
    k = t.find("\n  function destroy()", j)
    if j < 0 or k < 0:
        print(name, "skip", j, k)
        continue
    t = t[:j] + catch_block(label) + t[k:]
    for noise in [
        "el.innerHTML = el.innerHTML.replace(/motion/g, 'div');\n",
        "el.innerHTML = el.innerHTML.replace(/<\\/?motion\\b[^>]*>/gi, '');\n",
        "el.innerHTML = el.innerHTML.replace(/<div /gi, '<motion ').replace(/<\\/motion>/gi, '</div>');\n",
    ]:
        t = t.replace(noise, "")
    p.write_text(t, encoding="utf-8")
    print(name, "patched")
