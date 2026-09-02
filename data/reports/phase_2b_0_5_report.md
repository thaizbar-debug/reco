# Phase 2B-0.5 — Pilot Verification Report

**Generated:** 2026-09-02T19:51:07.003Z
**Phase:** 2B-0.5
**Analysis date:** 2026-09-02T19:46:10.172Z

## Executive Summary

**Overall verdict:** [COND] CONDITIONAL

Conditional — 4 condition(s) not fully met: 1. 3/5 pilot districts pass acceptance (>=50): PARTIAL; 2. Miraflores coverage > 30%: FAIL; 3. SJL file < 5MB gzip: CANNOT_EVALUATE; 6. No degradation from new sources: CANNOT_EVALUATE.

- **Sources attempted:** 0
- **Sources with data:** 0
- **Total external features acquired:** 0

## Source Audit

| Source | Districts Queried | Features Acquired | Status |
|--------|-------------------|-------------------|--------|

## District Results

| District | Existing | External | Coverage Existing | Coverage New | Score | Verdict |
|----------|----------|----------|-------------------|--------------|-------|---------|
| MIRAFLORES | 668 | 0 | 4.7% | — | 80 | PASS |
| LA VICTORIA | 0 | 0 | 0% | — | 0 | NO_DATA |
| SURQUILLO | 399 | 0 | 72.5% | — | 90 | PASS |
| CHORRILLOS | 0 | 0 | 0% | — | 0 | NO_DATA |
| SAN JUAN DE LURIGANCHO | 0 | 0 | 0% | — | 0 | NO_DATA |

### MIRAFLORES

- **Ubigeo:** 150122
- **District area:** 9.23 km²

**Existing data:**
- Features: 668
- Geometry types: {"Polygon":668}
- Polygons: 668, LineStrings: 0
- Area: 0.4351 km²
- Invalid: 0, Degenerate: 0, Duplicates: 0
- Area stats: min=48.5m² median=366m² max=48661.8m²
- Semantic: {"PARCEL":{"count":662,"total_area_km2":0.3242},"BLOCK":{"count":6,"total_area_km2":0.1109}}


**Cross-source comparison:**
- existing_published vs existing_raw:
  Matched: 668, Only A: 0, Only B: 0
  IoU(bbox): mean=1, median=1
  Area diff: mean=0%, median=0%

**Merge simulation:**
- Source: —
- Current: 668, Candidate: 0
- Actions: KEEP=668, ADD=0, REPLACE=0, REVIEW=0, REJECT=0
- Simulated total: —

**No-degradation gate:** PASS

**Acceptance score:** 80/100 — PASS
- Breakdown: {"geometry":20,"crs":15,"topology":15,"duplicates":10,"area":10,"coverage":3,"attribution":5,"freshness":2}

**Confidence:** MEDIUM (B)
- Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.

**Performance:** read=0ms, decompress=1ms, parse=7ms, total=8ms

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** KEEP — Only existing data available. Acquire external sources for improvement.

---

### LA VICTORIA

- **Ubigeo:** 150115
- **District area:** 9.122 km²

**Existing data:** None


**Merge simulation:**
- Source: —
- Current: 0, Candidate: 0
- Actions: KEEP=0, ADD=0, REPLACE=0, REVIEW=0, REJECT=0
- Simulated total: —

**No-degradation gate:** NO_DATA

**Acceptance score:** 0/100 — NO_DATA
- Breakdown: {}

**Confidence:** NO_DATA (D)
- No data available for this district from any source.

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** ACQUIRE — No data. Must acquire from COFOPRI, GEO GPS Peru, or GEOIDEP.

---

### SURQUILLO

- **Ubigeo:** 150141
- **District area:** 4.66 km²

**Existing data:**
- Features: 399
- Geometry types: {"Polygon":399}
- Polygons: 399, LineStrings: 0
- Area: 3.4662 km²
- Invalid: 0, Degenerate: 0, Duplicates: 0
- Area stats: min=87.3m² median=6721.2m² max=135938m²
- Semantic: {"BLOCK":{"count":255,"total_area_km2":2.6539},"PARCEL":{"count":140,"total_area_km2":0.4191},"ZONE":{"count":4,"total_area_km2":0.3932}}


**Cross-source comparison:**
- existing_published vs existing_raw:
  Matched: 399, Only A: 0, Only B: 0
  IoU(bbox): mean=1, median=1
  Area diff: mean=0%, median=0%

**Merge simulation:**
- Source: —
- Current: 399, Candidate: 0
- Actions: KEEP=399, ADD=0, REPLACE=0, REVIEW=0, REJECT=0
- Simulated total: —

**No-degradation gate:** PASS

**Acceptance score:** 90/100 — PASS
- Breakdown: {"geometry":20,"crs":15,"topology":15,"duplicates":10,"area":8,"coverage":15,"attribution":5,"freshness":2}

**Confidence:** MEDIUM (B)
- Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.

**Performance:** read=0ms, decompress=0ms, parse=2ms, total=2ms

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** KEEP — Only existing data available. Acquire external sources for improvement.

---

### CHORRILLOS

- **Ubigeo:** 150108
- **District area:** 34.464 km²

**Existing data:** None


**Merge simulation:**
- Source: —
- Current: 0, Candidate: 0
- Actions: KEEP=0, ADD=0, REPLACE=0, REVIEW=0, REJECT=0
- Simulated total: —

**No-degradation gate:** NO_DATA

**Acceptance score:** 0/100 — NO_DATA
- Breakdown: {}

**Confidence:** NO_DATA (D)
- No data available for this district from any source.

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** ACQUIRE — No data. Must acquire from COFOPRI, GEO GPS Peru, or GEOIDEP.

---

### SAN JUAN DE LURIGANCHO

- **Ubigeo:** 150132
- **District area:** 141.467 km²

**Existing data:** None


**Merge simulation:**
- Source: —
- Current: 0, Candidate: 0
- Actions: KEEP=0, ADD=0, REPLACE=0, REVIEW=0, REJECT=0
- Simulated total: —

**No-degradation gate:** NO_DATA

**Acceptance score:** 0/100 — NO_DATA
- Breakdown: {}

**Confidence:** NO_DATA (D)
- No data available for this district from any source.

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** ACQUIRE — No data. Must acquire from COFOPRI, GEO GPS Peru, or GEOIDEP.

---

## Data Quality

| District | Invalid | Degenerate | Duplicates | Semantic |
|----------|---------|------------|------------|----------|
| MIRAFLORES | — | — | — | — |
| LA VICTORIA | — | — | — | — |
| SURQUILLO | — | — | — | — |
| CHORRILLOS | — | — | — | — |
| SAN JUAN DE LURIGANCHO | — | — | — | — |

## Performance

| District | RAW KB | GZ KB | Features | Vertices | Total ms | Browser est. |
|----------|--------|-------|----------|----------|----------|--------------|
| MIRAFLORES | — | — | 668 | 4466 | 8 | 16ms |
| LA VICTORIA | — | — | — | — | — | — |
| SURQUILLO | — | — | 399 | 2616 | 2 | 4ms |
| CHORRILLOS | — | — | — | — | — | — |
| SAN JUAN DE LURIGANCHO | — | — | — | — | — | — |

## Provenance

| District | Source | URL | Acquired | Verification |
|----------|-------|-----|----------|--------------|
| MIRAFLORES | — | — | — | — |
| LA VICTORIA | — | — | — | — |
| SURQUILLO | — | — | — | — |
| CHORRILLOS | — | — | — | — |
| SAN JUAN DE LURIGANCHO | — | — | — | — |

## Risks

- **SURQUILLO:** Existing polygons are manzanas (median 6720m²), not individual parcels. All 5813 LineStrings are open (frontage). LS→Polygon conversion NOT viable.

## GO / NO-GO

| # | Condition | Status | Detail |
|---|-----------|--------|--------|
| 1 | 3/5 pilot districts pass acceptance (>=50) | PARTIAL | 2/5 districts meet threshold: miraflores, surquillo |
| 2 | Miraflores coverage > 30% | FAIL | Current coverage 4.7%. Below 30% threshold. |
| 3 | SJL file < 5MB gzip | CANNOT_EVALUATE | No file size data available. |
| 4 | No regressions in existing 22 districts | PASS | parcel_master unchanged. This analysis is read-only. |
| 5 | Pipeline is reproducible | PASS | ETL scripts exist and run deterministically. |
| 6 | No degradation from new sources | CANNOT_EVALUATE | No external sources acquired to evaluate. |

### Verdict: CONDITIONAL

Conditional — 4 condition(s) not fully met: 1. 3/5 pilot districts pass acceptance (>=50): PARTIAL; 2. Miraflores coverage > 30%: FAIL; 3. SJL file < 5MB gzip: CANNOT_EVALUATE; 6. No degradation from new sources: CANNOT_EVALUATE.

---
*Generated by tools/etl/pilot_report.js — 2026-09-02T19:51:07.021Z*