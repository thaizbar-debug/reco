#!/usr/bin/env node
/**
 * PHASE 2B-0.5: Pilot Report Generator
 * Reads pilot_analysis_results.json and generates:
 *   - data/reports/phase_2b_0_5_report.json (structured)
 *   - data/reports/phase_2b_0_5_report.md   (human-readable)
 *
 * Usage: node tools/etl/pilot_report.js
 */

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '../..');
const RESULTS_FILE = path.join(BASE, 'data/reports/pilot_analysis_results.json');
const REPORT_JSON = path.join(BASE, 'data/reports/phase_2b_0_5_report.json');
const REPORT_MD = path.join(BASE, 'data/reports/phase_2b_0_5_report.md');

const PILOT_SLUGS = ['miraflores', 'la-victoria', 'surquillo', 'chorrillos', 'san-juan-de-lurigancho'];

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`ERROR: ${RESULTS_FILE} not found.`);
    console.error('Run "npm run pilot:analyze" first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
}

function getExistingData(d) {
  if (!d) return null;
  if (d.existing && d.existing.published) return d.existing.published;
  if (d.existing && d.existing.analysis) return d.existing;
  if (d.published) return d.published;
  return null;
}

function verdictEmoji(v) {
  if (v === 'PASS' || v === 'GO') return '[PASS]';
  if (v === 'CONDITIONAL') return '[COND]';
  if (v === 'FAIL' || v === 'NO_GO') return '[FAIL]';
  if (v === 'BLOCKED') return '[BLCK]';
  return '[????]';
}

function pad(s, n) { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function buildMarkdownReport(results) {
  const lines = [];
  const w = s => lines.push(s);

  w('# Phase 2B-0.5 — Pilot Verification Report');
  w('');
  w(`**Generated:** ${new Date().toISOString()}`);
  w(`**Phase:** ${results.phase || '2B-0.5'}`);
  w(`**Analysis date:** ${results.analysis_date || 'N/A'}`);
  w('');

  // Executive Summary
  w('## Executive Summary');
  w('');
  const go = results.go_nogo || {};
  w(`**Overall verdict:** ${verdictEmoji(go.overall)} ${go.overall || 'UNKNOWN'}`);
  w('');
  if (go.summary) w(go.summary);
  w('');

  // Source counts
  let totalSources = 0, totalFeatures = 0, sourcesSucceeded = 0;
  const districtResults = results.districts || {};
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    const ext = d.external_sources || {};
    for (const src of Object.keys(ext)) {
      const ds = ext[src];
      if (!ds || typeof ds !== 'object') continue;
      totalSources++;
      if (ds.analysis && (ds.analysis.feature_count || ds.analysis.total_features || 0) > 0) {
        sourcesSucceeded++;
        totalFeatures += (ds.analysis.feature_count || ds.analysis.total_features || 0);
      }
    }
  }

  w(`- **Sources attempted:** ${totalSources}`);
  w(`- **Sources with data:** ${sourcesSucceeded}`);
  w(`- **Total external features acquired:** ${totalFeatures.toLocaleString()}`);
  w('');

  // Source Audit
  w('## Source Audit');
  w('');
  w('| Source | Districts Queried | Features Acquired | Status |');
  w('|--------|-------------------|-------------------|--------|');

  const sourceAgg = {};
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    const ext = d.external_sources || {};
    for (const [src, data] of Object.entries(ext)) {
      if (!sourceAgg[src]) sourceAgg[src] = { queried: 0, features: 0, errors: [] };
      sourceAgg[src].queried++;
      if (data && data.analysis) sourceAgg[src].features += (data.analysis.feature_count || data.analysis.total_features || 0);
      if (data && data.errors && data.errors.length > 0) sourceAgg[src].errors.push(...data.errors);
    }
  }

  for (const [src, agg] of Object.entries(sourceAgg)) {
    const status = agg.features > 0 ? 'VERIFIED' : (agg.errors.length > 0 ? 'FAILED' : 'NO_DATA');
    w(`| ${src} | ${agg.queried} | ${agg.features.toLocaleString()} | ${status} |`);
  }
  w('');

  // District Results
  w('## District Results');
  w('');
  w('| District | Existing | External | Coverage Existing | Coverage New | Score | Verdict |');
  w('|----------|----------|----------|-------------------|--------------|-------|---------|');

  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) {
      w(`| ${slug} | — | — | — | — | — | NO_DATA |`);
      continue;
    }
    const existing = getExistingData(d) || {};
    const existCount = existing.analysis ? (existing.analysis.feature_count || existing.analysis.total_features || 0) : 0;

    let extCount = 0;
    const ext = d.external_sources || {};
    for (const data of Object.values(ext)) {
      if (data && data.analysis) extCount += (data.analysis.feature_count || data.analysis.total_features || 0);
    }

    const covExist = existing.district_comparison ? existing.district_comparison.coverage_pct + '%' : '0%';
    const acc = d.acceptance_score || {};
    const bestExtCov = d.merge_simulation && d.merge_simulation.coverage_change_pct
      ? d.merge_simulation.coverage_change_pct + '%'
      : '—';

    w(`| ${d.name || slug} | ${existCount.toLocaleString()} | ${extCount.toLocaleString()} | ${covExist} | ${bestExtCov} | ${acc.total || 0} | ${acc.verdict || 'N/A'} |`);
  }
  w('');

  // Individual district sections
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;

    const name = d.name || slug;
    w(`### ${name}`);
    w('');
    w(`- **Ubigeo:** ${d.ubigeo || '—'}`);
    w(`- **District area:** ${d.district_area_km2 || '—'} km²`);
    w('');

    // Existing data
    const existing = getExistingData(d);
    if (existing && existing.analysis) {
      const a = existing.analysis;
      w('**Existing data:**');
      w(`- Features: ${a.feature_count || a.total_features}`);
      w(`- Geometry types: ${JSON.stringify(a.geometry_types)}`);
      w(`- Polygons: ${a.polygons}, LineStrings: ${a.linestrings}`);
      w(`- Area: ${a.total_area_km2} km²`);
      w(`- Invalid: ${a.invalid_geometries}, Degenerate: ${a.degenerate}, Duplicates: ${a.duplicates_bbox}`);
      if (a.area_stats) {
        w(`- Area stats: min=${a.area_stats.min_m2}m² median=${a.area_stats.median_m2}m² max=${a.area_stats.max_m2}m²`);
      }
      if (a.semantic_breakdown) {
        w(`- Semantic: ${JSON.stringify(a.semantic_breakdown)}`);
      }
    } else {
      w('**Existing data:** None');
    }
    w('');

    // External sources
    const ext = d.external_sources || {};
    if (Object.keys(ext).length > 0) {
      w('**External sources:**');
      for (const [src, data] of Object.entries(ext)) {
        if (!data) continue;
        if (data.analysis && (data.analysis.feature_count || data.analysis.total_features || 0) > 0) {
          const a = data.analysis;
          w(`- **${src}:** ${a.feature_count || a.total_features} features (${a.polygons} polygons, ${a.linestrings} LS)`);
          if (a.semantic_breakdown) {
            const sb = a.semantic_breakdown;
            const parts = [];
            for (const [k, v] of Object.entries(sb)) {
              if (v && v.count > 0) parts.push(`${k}:${v.count}`);
            }
            w(`  Semantic: ${parts.join(', ')}`);
          }
        } else if (data.errors && data.errors.length > 0) {
          w(`- **${src}:** FAILED — ${data.errors[0].error || data.errors[0]}`);
        } else {
          w(`- **${src}:** ${data.status || 'NO_DATA'}`);
        }
      }
    }
    w('');

    // Cross-source comparison
    if (d.cross_source_comparison && d.cross_source_comparison.length > 0) {
      w('**Cross-source comparison:**');
      for (const cmp of d.cross_source_comparison) {
        w(`- ${cmp.datasets[0]} vs ${cmp.datasets[1]}:`);
        if (cmp.matching) {
          w(`  Matched: ${cmp.matching.matched}, Only A: ${cmp.matching.only_in_a}, Only B: ${cmp.matching.only_in_b}`);
        }
        if (cmp.iou_bbox) {
          w(`  IoU(bbox): mean=${cmp.iou_bbox.mean}, median=${cmp.iou_bbox.median}`);
        }
        if (cmp.area_diff_pct) {
          w(`  Area diff: mean=${cmp.area_diff_pct.mean}%, median=${cmp.area_diff_pct.median}%`);
        }
      }
      w('');
    }

    // Merge simulation
    if (d.merge_simulation) {
      const ms = d.merge_simulation;
      w('**Merge simulation:**');
      if (ms.actions) {
        w(`- Source: ${ms.source || '—'}`);
        w(`- Current: ${ms.current_count || 0}, Candidate: ${ms.candidate_count || 0}`);
        w(`- Actions: KEEP=${ms.actions.KEEP_EXISTING || 0}, ADD=${ms.actions.ADD_NEW || 0}, REPLACE=${ms.actions.REPLACE_EXISTING || 0}, REVIEW=${ms.actions.REVIEW || 0}, REJECT=${ms.actions.REJECT || 0}`);
        w(`- Simulated total: ${ms.simulated_total || '—'}`);
      } else {
        w(`- ${ms.note || 'No simulation possible'}`);
      }
      w('');
    }

    // No-degradation gate
    if (d.no_degradation) {
      w(`**No-degradation gate:** ${d.no_degradation}`);
      w('');
    }

    // Acceptance score
    if (d.acceptance_score) {
      const acc = d.acceptance_score;
      w(`**Acceptance score:** ${acc.total}/100 — ${acc.verdict}`);
      if (acc.breakdown) w(`- Breakdown: ${typeof acc.breakdown === 'string' ? acc.breakdown : JSON.stringify(acc.breakdown)}`);
      w('');
    }

    // Confidence
    if (d.confidence) {
      w(`**Confidence:** ${d.confidence.level} (${d.confidence.code})`);
      w(`- ${d.confidence.reason}`);
      w('');
    }

    // Performance
    const perf = d.performance && d.performance.published ? d.performance.published : d.performance;
    if (perf && perf.total_ms !== undefined) {
      w(`**Performance:** read=${perf.read_ms}ms, decompress=${perf.decompress_ms}ms, parse=${perf.parse_ms}ms, total=${perf.total_ms}ms`);
      w('');
    }

    // Provenance
    if (d.provenance) {
      w('**Provenance:**');
      const prov = d.provenance;
      w(`- Source: ${prov.source || prov.source_name || '—'}`);
      w(`- URL: ${prov.source_url || '—'}`);
      w(`- Acquired: ${prov.acquisition_date || prov.acquired_at || '—'}`);
      w(`- Verification: ${prov.verification_status || '—'}`);
      w('');
    }

    if (d.recommendation) {
      w(`**Recommendation:** ${d.recommendation}`);
      w('');
    }

    w('---');
    w('');
  }

  // Data Quality
  w('## Data Quality');
  w('');
  w('| District | Invalid | Degenerate | Duplicates | Semantic |');
  w('|----------|---------|------------|------------|----------|');
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    const a = (d.existing || d.published || {}).analysis;
    if (a) {
      const sem = a.semantic_breakdown
        ? Object.entries(a.semantic_breakdown).filter(([, v]) => v && v.count > 0).map(([k, v]) => `${k}:${v.count}`).join(' ')
        : '—';
      w(`| ${d.name} | ${a.invalid_geometries} | ${a.degenerate} | ${a.duplicates_bbox} | ${sem} |`);
    } else {
      w(`| ${d.name || slug} | — | — | — | — |`);
    }
  }
  w('');

  // Performance
  w('## Performance');
  w('');
  w('| District | RAW KB | GZ KB | Features | Vertices | Total ms | Browser est. |');
  w('|----------|--------|-------|----------|----------|----------|--------------|');
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    const perf = d.performance && d.performance.published ? d.performance.published : d.performance;
    const fileSizes = perf && perf.file_sizes ? perf.file_sizes : {};
    const existData = getExistingData(d);
    const a = existData ? existData.analysis : null;
    if (a && perf) {
      w(`| ${d.name} | ${fileSizes.raw_kb || '—'} | ${fileSizes.gz_kb || '—'} | ${a.feature_count || a.total_features || '—'} | ${a.total_vertices || '—'} | ${perf.total_ms || perf.read_ms || '—'} | ${perf.estimated_browser_ms ? perf.estimated_browser_ms + 'ms' : '—'} |`);
    } else {
      w(`| ${d.name || slug} | — | — | — | — | — | — |`);
    }
  }
  w('');

  // Provenance summary
  w('## Provenance');
  w('');
  w('| District | Source | URL | Acquired | Verification |');
  w('|----------|-------|-----|----------|--------------|');
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d || !d.provenance) continue;
    const p = d.provenance;
    w(`| ${d.name} | ${p.source || p.source_name || '—'} | ${p.source_url || '—'} | ${p.acquisition_date || p.acquired_at || '—'} | ${p.verification_status || '—'} |`);
  }
  w('');

  // Risks
  w('## Risks');
  w('');
  const risks = [];
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    if (!d.existing && !d.published && Object.keys(d.external_sources || {}).every(k => {
      const s = d.external_sources[k];
      return !s || !s.analysis || (s.analysis.feature_count || s.analysis.total_features || 0) === 0;
    })) {
      risks.push(`- **${d.name}:** No data from any source. Cannot evaluate this district.`);
    }
    if (slug === 'surquillo') {
      risks.push('- **SURQUILLO:** Existing polygons are manzanas (median 6720m²), not individual parcels. All 5813 LineStrings are open (frontage). LS→Polygon conversion NOT viable.');
    }
    if (slug === 'san-juan-de-lurigancho' && d.performance) {
      const perfSjl = d.performance.published || d.performance;
      const est = perfSjl.estimated_browser_ms;
      if (est > 3000) {
        risks.push(`- **SJL:** Estimated browser render time ${est}ms exceeds 3s target. May need lazy loading or tile splitting.`);
      }
    }
  }
  if (risks.length === 0) risks.push('- No critical risks identified.');
  risks.forEach(r => w(r));
  w('');

  // GO / NO-GO
  w('## GO / NO-GO');
  w('');
  if (go.conditions) {
    w('| # | Condition | Status | Detail |');
    w('|---|-----------|--------|--------|');
    for (const c of go.conditions) {
      w(`| ${c.id} | ${c.desc} | ${c.status} | ${c.reason} |`);
    }
    w('');
  }
  w(`### Verdict: ${go.overall || 'UNKNOWN'}`);
  w('');
  if (go.summary) w(go.summary);
  w('');

  w('---');
  w(`*Generated by tools/etl/pilot_report.js — ${new Date().toISOString()}*`);

  return lines.join('\n');
}

function buildJsonReport(results) {
  const report = {
    phase: '2B-0.5',
    generated: new Date().toISOString(),
    analysis_date: results.analysis_date || results.pilot_date,
    executive_summary: {
      overall_verdict: (results.go_nogo || {}).overall || 'UNKNOWN',
      districts_analyzed: PILOT_SLUGS.length,
      districts_with_existing: 0,
      districts_with_external: 0,
      total_existing_features: 0,
      total_external_features: 0
    },
    districts: {},
    go_nogo: results.go_nogo || {},
    risks: [],
    recommendations: []
  };

  const districtResults = results.districts || {};
  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;

    const existing = getExistingData(d);
    const existFc = existing && existing.analysis ? (existing.analysis.feature_count || existing.analysis.total_features || 0) : 0;
    if (existFc > 0) {
      report.executive_summary.districts_with_existing++;
      report.executive_summary.total_existing_features += existFc;
    }

    const ext = d.external_sources || {};
    let hasExternal = false;
    for (const data of Object.values(ext)) {
      const extFc = data && data.analysis ? (data.analysis.feature_count || data.analysis.total_features || 0) : 0;
      if (extFc > 0) {
        hasExternal = true;
        report.executive_summary.total_external_features += extFc;
      }
    }
    if (hasExternal) report.executive_summary.districts_with_external++;

    report.districts[slug] = d;
  }

  return report;
}

function main() {
  console.log('PHASE 2B-0.5 REPORT GENERATOR');
  console.log('='.repeat(50));

  const results = loadResults();

  // Generate JSON report
  const jsonReport = buildJsonReport(results);
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(jsonReport, null, 2));
  console.log(`JSON report: ${REPORT_JSON}`);

  // Generate Markdown report
  const mdReport = buildMarkdownReport(results);
  fs.writeFileSync(REPORT_MD, mdReport);
  console.log(`Markdown report: ${REPORT_MD}`);

  // Print summary to console
  console.log('');
  console.log('SUMMARY');
  console.log('─'.repeat(50));

  const es = jsonReport.executive_summary;
  console.log(`  Districts with existing data: ${es.districts_with_existing}/5`);
  console.log(`  Districts with external data: ${es.districts_with_external}/5`);
  console.log(`  Total existing features: ${es.total_existing_features.toLocaleString()}`);
  console.log(`  Total external features: ${es.total_external_features.toLocaleString()}`);
  console.log(`  Overall verdict: ${es.overall_verdict}`);
  console.log('');

  const districtResults = results.districts || {};
  console.log(`  ${'District'.padEnd(30)} ${'Existing'.padStart(10)} ${'External'.padStart(10)} ${'Score'.padStart(7)} ${'Verdict'.padStart(12)}`);
  console.log(`  ${'─'.repeat(30)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(7)} ${'─'.repeat(12)}`);

  for (const slug of PILOT_SLUGS) {
    const d = districtResults[slug];
    if (!d) continue;
    const existing = getExistingData(d);
    const existCount = existing && existing.analysis ? (existing.analysis.feature_count || existing.analysis.total_features || 0) : 0;
    let extCount = 0;
    for (const data of Object.values(d.external_sources || {})) {
      if (data && data.analysis) extCount += (data.analysis.feature_count || data.analysis.total_features || 0);
    }
    const acc = d.acceptance_score || {};
    console.log(`  ${(d.name || slug).padEnd(30)} ${String(existCount).padStart(10)} ${String(extCount).padStart(10)} ${String(acc.total || 0).padStart(7)} ${(acc.verdict || 'N/A').padStart(12)}`);
  }
  console.log('');
}

main();
