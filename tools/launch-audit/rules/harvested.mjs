// tools/launch-audit/rules/harvested.mjs — Layer A turned into findings.
//
// These CITE. A qa BLOCKER appears here as one finding pointing at
// qa-report.md, never as a restatement of the underlying defect: two reports
// with two severities for one problem is worse than one report.
import { finding } from '../../launch-audit.mjs';

export const harvestedRules = [
  {
    id: 'HARV001',
    // Absence of a QA run is not a pass. UNVERIFIED keeps it out of a clean GO
    // while making clear nobody claimed the site is broken.
    run: (facts) => {
      const h = facts.harvest;
      if (!h || h.qa?.present) return [];
      return [finding({
        rule: 'HARV001', category: 'carried', severity: 'UNVERIFIED', owner: 'developer',
        where: h.qa?.path || '.twt-artifacts/qa/qa-report.md',
        evidence: 'no qa-report.md exists — QA has never run against this build',
      })];
    },
  },
  {
    id: 'HARV002',
    run: (facts) => {
      const qa = facts.harvest?.qa;
      if (!qa?.present || !(qa.blockers > 0)) return [];
      return [finding({
        rule: 'HARV002', category: 'carried', severity: 'LAUNCH-BLOCKER', owner: 'developer',
        where: qa.path,
        evidence: `${qa.blockers} unresolved BLOCKER${qa.blockers === 1 ? '' : 's'} in ${qa.path} (verdict ${qa.verdict})`,
      })];
    },
  },
  {
    id: 'HARV003',
    run: (facts) => {
      const g = facts.harvest?.gaps;
      if (!g?.present || !(g.open_items > 0)) return [];
      return [finding({
        rule: 'HARV003', category: 'content', severity: 'LAUNCH-BLOCKER', owner: 'content-owner',
        where: g.path,
        evidence: `${g.open_items} open item${g.open_items === 1 ? '' : 's'} in ${g.path}`,
      })];
    },
  },
  {
    id: 'HARV004',
    run: (facts) => {
      const a = facts.harvest?.approval;
      if (!a?.present || a.reader !== 'ok' || !(a.not_ready > 0)) return [];
      return [finding({
        rule: 'HARV004', category: 'content', severity: 'LAUNCH-BLOCKER', owner: 'content-owner',
        where: a.path,
        evidence: `${a.not_ready} of ${a.total} content rows are not marked ready in ${a.path}`,
      })];
    },
  },
  {
    id: 'HARV005',
    run: (facts) => {
      const a = facts.harvest?.approval;
      if (!a?.present || a.reader !== 'failed') return [];
      return [finding({
        rule: 'HARV005', category: 'content', severity: 'UNVERIFIED', owner: 'content-owner',
        where: a.path,
        evidence: 'the approval workbook exists but could not be read — sign-off state is unknown',
      })];
    },
  },
  {
    id: 'HARV006',
    run: (facts) => {
      const s = facts.harvest?.staleness;
      if (!s || s.status !== 'ok' || !(s.stale > 0)) return [];
      return [finding({
        rule: 'HARV006', category: 'carried', severity: 'FIX-WEEK-ONE', owner: 'developer',
        where: '.twt-artifacts/',
        evidence: `${s.stale} artifact${s.stale === 1 ? '' : 's'} stale relative to their inputs: ${s.stale_paths.slice(0, 5).join(', ')}`,
      })];
    },
  },
  {
    id: 'HARV007',
    run: (facts) => (facts.harvest?.validations || [])
      .filter((v) => v.blockers > 0)
      .map((v) => finding({
        rule: 'HARV007', category: 'carried', severity: 'LAUNCH-BLOCKER', owner: 'developer',
        where: v.path,
        evidence: `${v.blockers} unresolved BLOCKER${v.blockers === 1 ? '' : 's'} in ${v.path}`,
      })),
  },
];
