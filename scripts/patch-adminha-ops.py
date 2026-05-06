from pathlib import Path

p = Path(__file__).resolve().parent.parent / "website" / "adminha.html"
t = p.read_text(encoding="utf-8")
marker_start = '        <section id="section-ops" class="panel">'
marker_end = '        <section id="section-administrators" class="panel">'
start = t.index(marker_start)
end = t.index(marker_end)

new = """        <section id="section-ops" class="panel">
          <div id="aiStateWorkspace" class="aist-root" aria-live="polite"></motion>
          <div id="opsLegacyWrap" hidden aria-hidden="true">
            <h2>Operations command center (legacy)</h2>
            <p class="admin-muted">Instalogist snapshot fallback.</p>
            <div id="opsObservabilityHost" class="admin-ops-obs" role="region" aria-label="Snapshot observability"></div>
            <div class="toolbar">
              <button type="button" class="btn" id="opsRefreshBtn">Refresh snapshot</button>
            </div>
            <div id="opsErrorHost" class="admin-ops-error" hidden role="alert"></div>
            <div id="opsWidgetsHost" class="cards-grid admin-ops-cards"></div>
            <div class="admin-ops-two-col">
              <div class="admin-ops-col">
                <h3>Escalation feed</h3>
                <ul id="opsEscalationFeed" class="admin-ops-feed"></ul>
              </div>
              <div class="admin-ops-col">
                <h3>Stale items</h3>
                <ul id="opsStaleFeed" class="admin-ops-feed"></ul>
              </div>
            </div>
          </div>
        </section>

"""
new = new.replace("<motion ", "<div ").replace("</motion>", "</div>")

p.write_text(t[:start] + new + t[end:], encoding="utf-8")
print("patched section-ops")
