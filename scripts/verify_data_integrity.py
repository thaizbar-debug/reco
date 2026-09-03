#!/usr/bin/env python3
"""
ReCo Data Integrity Verification
Compares platform data against the market intelligence source of truth
in branch claude/reco-admin-audit-21ojo0.

Run: python3 scripts/verify_data_integrity.py
"""
import json, re, subprocess, sys, os
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIT_BRANCH = "origin/claude/reco-admin-audit-21ojo0"
INDEX = ROOT / "index.html"
LANDING = ROOT / "landing.html"

RED = "\033[91m"
YEL = "\033[93m"
GRN = "\033[92m"
CYN = "\033[96m"
RST = "\033[0m"
BOLD = "\033[1m"

class Report:
    def __init__(self):
        self.checks = []
        self.fails = 0
        self.warns = 0
        self.ok = 0

    def fail(self, area, msg):
        self.checks.append(("FAIL", area, msg))
        self.fails += 1

    def warn(self, area, msg):
        self.checks.append(("WARN", area, msg))
        self.warns += 1

    def ok_(self, area, msg):
        self.checks.append(("OK", area, msg))
        self.ok += 1

    def print(self):
        icons = {"FAIL": f"{RED}FAIL{RST}", "WARN": f"{YEL}WARN{RST}", "OK": f"{GRN} OK {RST}"}
        print(f"\n{BOLD}{'='*60}")
        print(f" ReCo Data Integrity Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        print(f"{'='*60}{RST}\n")
        for status, area, msg in self.checks:
            print(f"  [{icons[status]}] {CYN}{area}{RST}: {msg}")
        print(f"\n{BOLD}  Summary: {GRN}{self.ok} OK{RST}, {YEL}{self.warns} WARN{RST}, {RED}{self.fails} FAIL{RST}")
        if self.fails:
            print(f"{RED}  Action required — {self.fails} check(s) failed.{RST}")
        elif self.warns:
            print(f"{YEL}  Review warnings above.{RST}")
        else:
            print(f"{GRN}  All checks passed.{RST}")
        print()
        return self.fails


def git_show(path):
    try:
        return subprocess.check_output(
            ["git", "show", f"{AUDIT_BRANCH}:{path}"],
            cwd=ROOT, stderr=subprocess.DEVNULL
        ).decode("utf-8")
    except subprocess.CalledProcessError:
        return None


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return None


def extract_tasaciones_hist(html):
    m = re.search(r'const TASACIONES_HIST\s*=\s*(\{.*?\});\s*\n', html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def check_tasaciones(r, html):
    area = "TASACIONES_HIST"
    embedded = extract_tasaciones_hist(html)
    if not embedded:
        r.fail(area, "Could not parse TASACIONES_HIST from index.html")
        return

    audit_raw = git_show("data/tasaciones_full.json")
    if not audit_raw:
        local_tas = load_json(ROOT / "data" / "tasaciones_full.json")
        if not local_tas:
            r.warn(area, "Cannot read tasaciones_full.json from audit branch or locally")
            return
        audit = local_tas
    else:
        audit = json.loads(audit_raw)

    if isinstance(audit, dict) and "distritos" in audit:
        audit_districts = set(audit["distritos"].keys())
        audit_meta = audit.get("metadata", {})
    elif isinstance(audit, dict):
        audit_districts = set(audit.keys())
        audit_meta = {}
    else:
        r.warn(area, f"Unexpected tasaciones_full.json format: {type(audit)}")
        return

    embedded_districts = set(embedded.keys())
    r.ok_(area, f"Embedded: {len(embedded_districts)} districts, Audit source: {len(audit_districts)} districts")

    missing = audit_districts - embedded_districts
    if len(missing) > 10:
        r.warn(area, f"{len(missing)} audit districts not in embedded data (may be below n threshold)")
    elif missing:
        r.warn(area, f"Districts in audit but not embedded: {', '.join(sorted(missing)[:10])}")

    san_isidro = embedded.get("SAN ISIDRO", {})
    if san_isidro:
        years = san_isidro.get("y", {})
        latest_yr = max(years.keys()) if years else None
        if latest_yr:
            median = years[latest_yr]["m"]
            if 2000 <= median <= 5000:
                r.ok_(area, f"San Isidro {latest_yr} median: ${median}/m² (plausible)")
            else:
                r.fail(area, f"San Isidro {latest_yr} median: ${median}/m² — outside expected range $2000-$5000")


def _extract_props(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("properties", data.get("historicos", []))
    return []


def check_properties(r):
    area = "Properties"
    local = load_json(ROOT / "data" / "properties.json")
    if not local:
        r.fail(area, "Cannot read local data/properties.json")
        return

    local_props = _extract_props(local)
    local_count = len(local_props)

    audit_raw = git_show("data/properties.json")
    if not audit_raw:
        r.warn(area, f"Cannot read properties.json from audit branch (local has {local_count} properties)")
        return

    audit = json.loads(audit_raw)
    audit_props = _extract_props(audit)
    audit_count = len(audit_props)

    if local_count == audit_count:
        r.ok_(area, f"Property count matches audit: {local_count}")
    elif local_count >= audit_count:
        r.ok_(area, f"Local ({local_count}) >= audit ({audit_count}) — local may include community publications")
    else:
        r.fail(area, f"Local ({local_count}) < audit ({audit_count}) — properties may have been lost")


def check_historicos_market(r):
    area = "Históricos market"
    local = load_json(ROOT / "data" / "historicos_market.json")
    if not local:
        r.fail(area, "Cannot read local data/historicos_market.json")
        return

    local_recs = _extract_props(local)
    local_count = len(local_recs)

    audit_raw = git_show("data/historicos_market.json")
    if not audit_raw:
        r.warn(area, f"Cannot read historicos_market.json from audit branch (local has {local_count} transactions)")
        return

    audit = json.loads(audit_raw)
    audit_recs = _extract_props(audit)
    audit_count = len(audit_recs)

    if local_count >= audit_count:
        r.ok_(area, f"Historical transactions: local={local_count}, audit={audit_count}")
    else:
        r.fail(area, f"Local ({local_count}) < audit ({audit_count}) — records lost")


def check_mock_values(r, html, landing_html):
    area = "Mock values"

    if "987654321" in html or "987654321" in landing_html:
        r.fail(area, "Placeholder WhatsApp 987654321 still present")
    else:
        r.ok_(area, "WhatsApp placeholder 987654321 not found")

    if "_SUGG=481000" in html or "_SUGG = 481000" in html:
        r.fail(area, "Mock valuation _SUGG=481000 still present")
    else:
        r.ok_(area, "Mock valuation _SUGG removed")

    if "_VALUATION_ENABLED = true" in html or "_VALUATION_ENABLED=true" in html:
        r.warn(area, "_VALUATION_ENABLED is true — valuation module is active (verify engine is ready)")
    elif "_VALUATION_ENABLED" in html:
        r.ok_(area, "_VALUATION_ENABLED toggle present and set to false")
    else:
        r.fail(area, "_VALUATION_ENABLED toggle not found in index.html")

    if "6.2, 8.4, 7.8, 7.1" in html or "score 7.5/10" in html.lower():
        r.fail(area, "Hardcoded investment scores still present")
    else:
        r.ok_(area, "Mock investment scores removed/hidden")

    mock_stats = re.findall(r'38 días|5\.9%.*negociación|\+6\.2% YoY', html)
    if mock_stats:
        r.fail(area, f"Mock market stats found: {mock_stats}")
    else:
        r.ok_(area, "Mock market context stats (38 días, 5.9%, +6.2% YoY) removed")

    if "847,000 transacciones" in html or "847.000 transacciones" in html:
        r.fail(area, 'FAQ still claims "847,000 transacciones"')
    else:
        r.ok_(area, "FAQ 847K transactions claim removed")

    if "MAPE ±4.2%" in html or "MAPE ±4.2" in html:
        r.fail(area, "FAQ still claims MAPE ±4.2%")
    else:
        r.ok_(area, "FAQ mock MAPE claim removed")


def check_faq_consistency(r, html):
    area = "FAQ consistency"
    local_tas = load_json(ROOT / "data" / "tasaciones_full.json")
    if not local_tas:
        r.warn(area, "Cannot read tasaciones_full.json for count verification")
        return

    meta = local_tas.get("metadata", {}) if isinstance(local_tas, dict) else {}
    with_valor = meta.get("total_registros_con_valor_unitario", 0)
    total = meta.get("total_registros_raw", 0)
    if not total:
        r.warn(area, "tasaciones_full.json has no metadata counts")
        return

    m47 = re.search(r'(\d[\d,.]+)\+?\s*tasaciones', html)
    if m47:
        claimed = m47.group(1).replace(",", "").replace(".", "")
        try:
            claimed_n = int(claimed)
        except ValueError:
            r.warn(area, f"Could not parse FAQ tasaciones count: {m47.group(0)}")
            return

        if abs(claimed_n - with_valor) / max(with_valor, 1) < 0.05:
            r.ok_(area, f"FAQ tasaciones count ({claimed_n}) ~matches records with valor ({with_valor})")
        elif abs(claimed_n - total) / max(total, 1) < 0.05:
            r.warn(area, f"FAQ claims {claimed_n} (matches total {total} but only {with_valor} have valor unitario)")
        else:
            r.fail(area, f"FAQ claims {claimed_n} tasaciones — actual: {total} total, {with_valor} with valor unitario")


def check_landing_counts(r, landing_html):
    area = "Landing counters"
    local = load_json(ROOT / "data" / "properties.json")
    if not local:
        r.warn(area, "Cannot read properties.json to verify landing counts")
        return

    actual_total = len(local)
    nums = re.findall(r'<span[^>]*class="[^"]*hero-num[^"]*"[^>]*>(\d+)', landing_html)
    if not nums:
        nums = re.findall(r'>(\d{2,4})<.*?(?:propiedades|departamentos|casas|terrenos)', landing_html, re.I)

    if nums:
        landing_total = max(int(n) for n in nums)
        if abs(landing_total - actual_total) / max(actual_total, 1) > 0.20:
            r.fail(area, f"Landing page shows ~{landing_total} but properties.json has {actual_total}")
        else:
            r.ok_(area, f"Landing counts within 20% of actual ({actual_total})")
    else:
        r.warn(area, "Could not parse landing page property counts")


def check_vanet_date(r, html):
    area = "Vanet freshness"
    m = re.search(r'Actualizado:\s*(\w+)\s+(\d{4})', html)
    if not m:
        r.warn(area, "Could not find Vanet update date in index.html")
        return

    month_map = {
        "Enero": 1, "Febrero": 2, "Marzo": 3, "Abril": 4,
        "Mayo": 5, "Junio": 6, "Julio": 7, "Agosto": 8,
        "Septiembre": 9, "Octubre": 10, "Noviembre": 11, "Diciembre": 12
    }
    month_name, year = m.group(1), int(m.group(2))
    month_num = month_map.get(month_name, 0)
    if not month_num:
        r.warn(area, f"Unknown month name: {month_name}")
        return

    now = datetime.now()
    months_old = (now.year - year) * 12 + (now.month - month_num)
    if months_old <= 1:
        r.ok_(area, f"Vanet date is current: {month_name} {year}")
    elif months_old <= 3:
        r.warn(area, f"Vanet date is {months_old} months old: {month_name} {year}")
    else:
        r.fail(area, f"Vanet date is {months_old} months stale: {month_name} {year}")


def check_fake_buttons(r, html):
    area = "Fake actions"
    fakes = []
    if "toast('PDF generado')" in html:
        fakes.append("Exportar PDF (toast only)")
    if "toast('Visita agendada" in html:
        fakes.append("Agendar visita (toast only)")
    if "toast('Enlace copiado" in html:
        pass  # this one is debatable, clipboard copy may be fine

    if fakes:
        r.warn(area, f"Buttons with fake actions: {', '.join(fakes)}")
    else:
        r.ok_(area, "No fake action buttons detected")


def check_exchange_rates(r):
    area = "Exchange rates"
    local = load_json(ROOT / "data" / "tc_pen_usd_bcrp.json")
    if not local:
        r.warn(area, "Cannot read tc_pen_usd_bcrp.json")
        return

    if isinstance(local, dict) and "mensual" in local:
        monthly = local["mensual"]
        if isinstance(monthly, dict):
            dates = sorted(monthly.keys())
        elif isinstance(monthly, list):
            dates = sorted([rec.get("fecha", rec.get("date", "")) for rec in monthly])
        else:
            dates = []
    elif isinstance(local, list):
        dates = sorted([rec.get("fecha", rec.get("date", "")) for rec in local])
    elif isinstance(local, dict):
        dates = sorted([k for k in local.keys() if k != "metadata"])
    else:
        r.warn(area, "Unexpected tc_pen_usd_bcrp.json format")
        return

    dates = [d for d in dates if d]
    if dates:
        latest = dates[-1]
        r.ok_(area, f"Exchange rate data through: {latest}")
    else:
        r.warn(area, "No dates found in exchange rate data")


def main():
    r = Report()

    if not INDEX.exists():
        print(f"{RED}ERROR: index.html not found at {INDEX}{RST}")
        sys.exit(1)

    html = INDEX.read_text()
    landing_html = LANDING.read_text() if LANDING.exists() else ""

    subprocess.run(
        ["git", "fetch", "origin", "claude/reco-admin-audit-21ojo0"],
        cwd=ROOT, capture_output=True
    )

    check_tasaciones(r, html)
    check_properties(r)
    check_historicos_market(r)
    check_mock_values(r, html, landing_html)
    check_faq_consistency(r, html)
    check_landing_counts(r, landing_html)
    check_vanet_date(r, html)
    check_fake_buttons(r, html)
    check_exchange_rates(r)

    fails = r.print()
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
