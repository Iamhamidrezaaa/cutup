from pathlib import Path

adminha = Path(__file__).resolve().parent.parent / "website" / "adminha.html"
frag = Path(__file__).resolve().parent.parent / "website" / "payments-section.fragment.html"

old = """        <section id="section-payments" class="panel">
          <h2>Payments</h2>
          <div class="filters-row">
            <label>From <input type="date" id="paymentsStartDate"></label>
            <label>To <input type="date" id="paymentsEndDate"></label>
            <label>Plan
              <select id="paymentsPlanFilter">
                <option value="all">All</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </label>
            <label>Status
              <select id="paymentsStatusFilter">
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <button type="button" class="btn" id="paymentsApplyFiltersBtn">Apply</button>
          </div>
          <div id="paymentsPanel"></div>
        </section>"""

new = frag.read_text(encoding="utf-8")
text = adminha.read_text(encoding="utf-8")
if old not in text:
    raise SystemExit('old block not found')
adminha.write_text(text.replace(old, new), encoding="utf-8")
print('patched adminha payments section')
