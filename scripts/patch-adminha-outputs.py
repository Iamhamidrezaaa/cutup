from pathlib import Path

adminha = Path(__file__).resolve().parent.parent / "website" / "adminha.html"
frag = Path(__file__).resolve().parent.parent / "website" / "outputs-section.fragment.html"

old = """        <section id="section-outputs" class="panel">
          <h2>Saved outputs</h2>
          <p id="outputsTableHint" class="sr-only">Saved outputs table with user, content type, and timestamps.</p>
          <div class="table-wrap"><table id="outputsTable" aria-label="Saved outputs table" aria-describedby="outputsTableHint"></table></div>
        </section>"""

new = frag.read_text(encoding="utf-8")
text = adminha.read_text(encoding="utf-8")
if old not in text:
    raise SystemExit("old block not found")
adminha.write_text(text.replace(old, new), encoding="utf-8")
print("patched adminha.html")
