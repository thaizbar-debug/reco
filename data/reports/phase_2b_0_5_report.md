# Phase 2B-0.5 — Pilot Verification Report

**Generated:** 2026-09-03T20:44:01.301Z
**Phase:** 2B-0.5
**Analysis date:** 2026-09-03T20:43:54.116Z

## Executive Summary

**Overall verdict:** [COND] CONDITIONAL

Conditional — 4 condition(s) not fully met: 1. 3/5 pilot districts final_status PASS or CONDITIONAL: PARTIAL; 2. Miraflores coverage >= 20% (Hard Gate C): FAIL; 3. SJL file < 5MB gzip: CANNOT_EVALUATE; 6. No degradation from new sources: CANNOT_EVALUATE.

- **Sources attempted:** 0
- **Sources with data:** 0
- **Total external features acquired:** 0

## Source Audit

| Source | Districts Queried | Features Acquired | Status |
|--------|-------------------|-------------------|--------|

## District Results

| District | Source | Semantic | Coverage | Score | Hard Gates | Final Status | Action |
|----------|--------|----------|----------|-------|------------|--------------|--------|
| MIRAFLORES | existing(668) | PARCEL | 4.7% | 80 | FAIL | CONDITIONAL | CONDITIONAL |
| LA VICTORIA | — | UNKNOWN | — | 0 | NO_DATA | NO_DATA | NO_DATA |
| SURQUILLO | existing(399) | BLOCK | 72.5% | 90 | FAIL | NOT_USABLE_FOR_PARCEL_MASTER | NOT_USABLE_FOR_PARCEL_MASTER |
| CHORRILLOS | — | UNKNOWN | — | 0 | NO_DATA | NO_DATA | NO_DATA |
| SAN JUAN DE LURIGANCHO | — | UNKNOWN | — | 0 | NO_DATA | NO_DATA | NO_DATA |

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

**Hard Gates:**
- Overall: **FAIL**

| Gate | Status | Detail |
|------|--------|--------|
| SEMANTIC | PASS | 99.1% of polygons are parcels |
| GEOMETRY | PASS | 100% valid, 100% polygons, CRS=EPSG:4326 |
| COVERAGE | FAIL | 4.7% coverage: below 5% minimum |
| DATA_IDENTITY | PASS | Classified as PARCEL by area-based geometric analysis (confidence: HIGH) |

- **Failed:** coverage

**Final Status:** **CONDITIONAL**

**Dataset Utility:**
- parcel_candidate: 662 features → parcel_master
- block_candidate: 6 features → block_master (conceptual, not in current architecture)

**Soft Score (quality metric):** 80/100
- Breakdown: {"geometry":20,"crs":15,"topology":15,"duplicates":10,"area":10,"coverage":3,"attribution":5,"freshness":2}

**Confidence:** MEDIUM (B)
- Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.

**Performance:** read=0ms, decompress=1ms, parse=2ms, total=3ms

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** CONDITIONAL — Gates: coverage. Score: 80/100. Acquire external sources to supplement.

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

**Hard Gates:**
- Overall: **NO_DATA**

| Gate | Status | Detail |
|------|--------|--------|

**Final Status:** **NO_DATA**

**Soft Score (quality metric):** 0/100
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

**Hard Gates:**
- Overall: **FAIL**

| Gate | Status | Detail |
|------|--------|--------|
| SEMANTIC | FAIL | Dataset is predominantly BLOCK/MANZANA (63.9%). Not usable as parcel data. |
| GEOMETRY | PASS | 100% valid, 100% polygons, CRS=EPSG:4326 |
| COVERAGE | PASS | 72.5% coverage meets 20% production threshold |
| DATA_IDENTITY | PASS | Classified as BLOCK by area-based geometric analysis (confidence: MEDIUM) |

- **Failed:** semantic

**Final Status:** **NOT_USABLE_FOR_PARCEL_MASTER**

**Dataset Utility:**
- parcel_candidate: 140 features → parcel_master
- block_candidate: 255 features → block_master (conceptual, not in current architecture)

**Soft Score (quality metric):** 90/100
- Breakdown: {"geometry":20,"crs":15,"topology":15,"duplicates":10,"area":8,"coverage":15,"attribution":5,"freshness":2}

**Confidence:** MEDIUM (B)
- Single source (GEO GPS probable), not cross-verified. Geometry valid, provenance undocumented.

**Performance:** read=1ms, decompress=0ms, parse=1ms, total=2ms

**Provenance:**
- Source: —
- URL: —
- Acquired: —
- Verification: —

**Recommendation:** NOT FOR PARCEL_MASTER — Data is BLOCK. Useful as: block_candidate(255). Need parcel-level source for this district.

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

**Hard Gates:**
- Overall: **NO_DATA**

| Gate | Status | Detail |
|------|--------|--------|

**Final Status:** **NO_DATA**

**Soft Score (quality metric):** 0/100
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

**Hard Gates:**
- Overall: **NO_DATA**

| Gate | Status | Detail |
|------|--------|--------|

**Final Status:** **NO_DATA**

**Soft Score (quality metric):** 0/100
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
| MIRAFLORES | 0 | 0 | 0 | PARCEL:662 BLOCK:6 |
| LA VICTORIA | — | — | — | — |
| SURQUILLO | 0 | 0 | 0 | BLOCK:255 PARCEL:140 ZONE:4 |
| CHORRILLOS | — | — | — | — |
| SAN JUAN DE LURIGANCHO | — | — | — | — |

## Performance

| District | RAW KB | GZ KB | Features | Vertices | Total ms | Browser est. |
|----------|--------|-------|----------|----------|----------|--------------|
| MIRAFLORES | — | — | 668 | 4466 | 3 | 6ms |
| LA VICTORIA | — | — | — | — | — | — |
| SURQUILLO | — | — | 399 | 2616 | 2 | 2ms |
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

## Acceptance Framework

### Hard Gates (blocking — any FAIL prevents PASS for parcel_master)

| Gate | Criteria Covered | Threshold |
|------|-----------------|-----------|
| **A: Semantic** | NEW — entity type | >=60% PARCEL polygons; BLOCK >50% → NOT_USABLE_FOR_PARCEL_MASTER |
| **B: Geometry** | geometry (20pt) + CRS (15pt) | >=95% valid + >=30% polygon; CRS=EPSG:4326 |
| **C: Coverage** | coverage (15pt) | >=20% PASS; 5-20% CONDITIONAL; <5% FAIL |
| **D: Data Identity** | NEW — classification method | Must be area-based geometric analysis, not layer name |

### Soft Score (quality gradient, 0-100, does NOT override hard gates)

| Criterion | Weight | Category | Rationale |
|-----------|--------|----------|-----------|
| geometry | 20 | also Hard Gate B | Polygon %, geometry type distribution |
| CRS | 15 | also Hard Gate B | Always WGS84 after normalization |
| topology | 15 | Soft only | Quality metric; partial data still usable |
| duplicates | 10 | Soft only | Cleanable in post-processing |
| area | 10 | Soft only | Indicator, not binary requirement |
| coverage | 15 | also Hard Gate C | Area coverage of district |
| attribution | 10 | Soft only | Missing provenance ≠ invalid geometry |
| freshness | 5 | Soft only | Old data can still be correct |

### Source Hierarchy (authority tier, must still pass hard gates)

| Tier | Category | Examples |
|------|----------|----------|
| 1 | OFFICIAL_CATASTRAL | COFOPRI, GEOIDEP, Municipal |
| 2 | DERIVED_DOCUMENTED | GEO GPS Peru |
| 3 | OTHER_GOVERNMENTAL | SEDAPAL, INEI |
| 4 | SECONDARY | Unknown/undocumented |
| 5 | OSM | NOT valid as catastro substitute |

## Risks

- **MIRAFLORES:** Coverage 4.7% below 20% production threshold. Data quality is good but insufficient extent.
- **LA VICTORIA:** No data from any source. Cannot evaluate this district.
- **SURQUILLO:** Data classified as BLOCK — NOT usable for parcel_master. Potentially useful as: block_candidate(255). Need parcel-level source.
- **CHORRILLOS:** No data from any source. Cannot evaluate this district.
- **SAN JUAN DE LURIGANCHO:** No data from any source. Cannot evaluate this district.

## GO / NO-GO

| # | Condition | Status | Detail |
|---|-----------|--------|--------|
| 1 | 3/5 pilot districts final_status PASS or CONDITIONAL | PARTIAL | 1/5 districts: miraflores |
| 2 | Miraflores coverage >= 20% (Hard Gate C) | FAIL | Current coverage 4.7%. Below 20% production threshold. |
| 3 | SJL file < 5MB gzip | CANNOT_EVALUATE | No file size data available. |
| 4 | No regressions in existing 22 districts | PASS | parcel_master unchanged. This analysis is read-only. |
| 5 | Pipeline is reproducible | PASS | ETL scripts exist and run deterministically. |
| 6 | No degradation from new sources | CANNOT_EVALUATE | No external sources acquired to evaluate. |
| 7 | No BLOCK dataset classified as PASS for parcel_master | PASS | 1 BLOCK dataset(s) correctly blocked: surquillo. |

### Verdict: CONDITIONAL

Conditional — 4 condition(s) not fully met: 1. 3/5 pilot districts final_status PASS or CONDITIONAL: PARTIAL; 2. Miraflores coverage >= 20% (Hard Gate C): FAIL; 3. SJL file < 5MB gzip: CANNOT_EVALUATE; 6. No degradation from new sources: CANNOT_EVALUATE.

---
*Generated by tools/etl/pilot_report.js — 2026-09-03T20:44:01.313Z*