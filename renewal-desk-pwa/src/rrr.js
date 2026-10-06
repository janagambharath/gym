/* ═══════════════════════════════════════════════════════════════════════
   RRR Gym Growth System — brand constant + client-side Revenue / Retain /
   Recover engine.

   BRAND is the single constant to flip the product name back (e.g. to
   "Renewal Desk"). Everything else in the RRR UI reads from it.

   Data comes ONLY from existing mobile API endpoints (see api.js) —
   no new backend routes. All ₹ figures derive from real plan/member
   data; nothing is hardcoded from mock screenshots.
   ═══════════════════════════════════════════════════════════════════════ */

import { apiRequest } from './api.js';

/* ─── Brand — flip back to Renewal Desk in one edit ─────────────────── */
export const BRAND = {
  name: 'RRR',
  tagline: 'Gym Growth System',
  headline: 'Grow more from the members you already have.',
  subhead: 'Revenue. Retain. Recover. The complete gym growth system.',
};

/* ─── Framework colours (match supplied screenshots) ────────────────── */
export const RRR_COLORS = {
  revenue: '#16a34a',
  revenueSoft: '#e8f7ee',
  retain: '#f59e0b',
  retainSoft: '#fef4e2',
  recover: '#ef4444',
  recoverSoft: '#fdecec',
};

export const RRR_META = {
  revenue: { key: 'revenue', title: 'REVENUE', subtitle: 'Grow revenue from existing members', color: RRR_COLORS.revenue, soft: RRR_COLORS.revenueSoft, icon: 'stats' },
  retain: { key: 'retain', title: 'RETAIN', subtitle: 'Prevent potential revenue loss', color: RRR_COLORS.retain, soft: RRR_COLORS.retainSoft, icon: 'shield' },
  recover: { key: 'recover', title: 'RECOVER', subtitle: 'Bring back lost revenue', color: RRR_COLORS.recover, soft: RRR_COLORS.recoverSoft, icon: 'renewals' },
};

/* ─── Formatting ────────────────────────────────────────────────────── */
export function fmtINR(value) {
  const n = Number(value) || 0;
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function fmtInt(value) {
  return (Number(value) || 0).toLocaleString('en-IN');
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateOnly(iso) {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

/* ─── Data fetching (existing endpoints only) ───────────────────────── */

/** Fetch ALL members across pages (cap 2000). */
export async function fetchAllMembers() {
  const members = [];
  let page = 1;
  for (;;) {
    const res = await apiRequest(`/api/mobile/v1/members?page=${page}&page_size=100`);
    if (!res.ok) return { ok: false, error: res.error };
    const batch = res.data.members || [];
    members.push(...batch);
    const totalPages = res.data.pagination?.total_pages || 1;
    if (page >= totalPages || page >= 20) break;
    page += 1;
  }
  return { ok: true, members };
}

/** Fetch visit history from access events (cap 1500 entries). */
export async function fetchVisits() {
  /** @type {Map<number, number[]>} memberId -> entry timestamps */
  const visits = new Map();
  let page = 1;
  let totalSeen = 0;
  for (;;) {
    const res = await apiRequest(
      `/api/mobile/v1/access/events?date=all&type=entry&per_page=100&page=${page}`
    );
    if (!res.ok) break; // attendance optional — degrade gracefully
    const events = res.data.events || res.data.log || [];
    for (const e of events) {
      if (e.member_id == null || e.is_invalid) continue;
      const t = new Date(e.event_timestamp).getTime();
      if (isNaN(t)) continue;
      if (!visits.has(e.member_id)) visits.set(e.member_id, []);
      visits.get(e.member_id).push(t);
    }
    totalSeen += events.length;
    const totalPages = res.data.pagination?.total_pages || 1;
    if (page >= totalPages || page >= 15 || totalSeen >= 1500) break;
    page += 1;
  }
  for (const arr of visits.values()) arr.sort((a, b) => a - b);
  return visits;
}

/** Load everything the RRR engine needs. */
export async function fetchRRRData() {
  const [membersRes, settingsRes, summaryRes] = await Promise.all([
    fetchAllMembers(),
    apiRequest('/api/mobile/v1/settings'),
    apiRequest('/api/mobile/v1/reports/summary?period=30d'),
  ]);
  if (!membersRes.ok) return { ok: false, error: membersRes.error };
  const visits = await fetchVisits();
  return {
    ok: true,
    members: membersRes.members,
    plans: settingsRes.ok ? settingsRes.data.plans || [] : [],
    visits,
    summary: summaryRes.ok ? summaryRes.data : null,
  };
}

/* ─── RRR computation (pure — same logic mirrored in web dashboard) ─── */

function planPriceOf(member) {
  const p = member.plan && member.plan.price;
  const n = parseFloat(p);
  return isNaN(n) ? 0 : n;
}

function visitStats(timestamps, today) {
  const d30 = today.getTime() - 30 * 86400000;
  const d60 = today.getTime() - 60 * 86400000;
  const d7 = today.getTime() - 7 * 86400000;
  let last = null, c30 = 0, cPrior = 0, c7 = 0;
  for (const t of timestamps) {
    if (last === null || t > last) last = t;
    if (t >= d30) c30 += 1;
    else if (t >= d60) cPrior += 1;
    if (t >= d7) c7 += 1;
  }
  return { last, c30, cPrior, c7 };
}

/**
 * Compute Revenue / Retain / Recover from real member + plan + visit data.
 * @param {Array} members  serialized members from /api/mobile/v1/members
 * @param {Array} plans    plans from /api/mobile/v1/settings
 * @param {Map} visits     memberId -> sorted entry timestamps (ms)
 */
export function computeRRR(members, plans, visits) {
  const today = startOfToday();
  const prices = plans.map((p) => parseFloat(p.price)).filter((n) => !isNaN(n) && n > 0);
  const maxPlanPrice = prices.length ? Math.max(...prices) : 0;
  const hasVisitData = visits.size > 0;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const live = members.filter((m) => !m.deleted_at);
  const active = live.filter((m) => m.status === 'active');

  /* ── RETAIN: at-risk active members ── */
  const atRisk = [];
  const breakdown = { declining: [], lowEngagement: [], planEnding: [], noVisits: [] };
  for (const m of active) {
    const end = parseDateOnly(m.membership_end);
    const due = end ? daysBetween(today, end) : (m.days_until_expiry ?? null);
    const joined = parseDateOnly(m.joined_on);
    const ageDays = joined ? Math.max(0, daysBetween(joined, today)) : 999;
    const ts = visits.get(m.id) || [];
    const v = visitStats(ts, today);
    const price = planPriceOf(m);
    const reasons = [];

    if (due !== null && due >= 0 && due <= 30) {
      reasons.push({ key: 'plan_ending', label: `Plan Ends (${due}d)` });
      breakdown.planEnding.push(m);
    }
    if (v.last !== null) {
      const d = daysBetween(new Date(v.last), today);
      if (d >= 14) {
        reasons.push({ key: 'no_visit', label: `No Visits (${d} days)` });
        breakdown.noVisits.push(m);
      }
    } else if (hasVisitData && ageDays > 60) {
      reasons.push({ key: 'no_visit', label: 'No Visits (60+ days)' });
      breakdown.noVisits.push(m);
    }
    if (v.cPrior >= 4 && v.c30 < v.cPrior * 0.7) {
      reasons.push({ key: 'declining', label: 'Declining Attendance' });
      breakdown.declining.push(m);
    }
    if (v.c30 <= 2 && ageDays > 30) {
      reasons.push({ key: 'low_engagement', label: 'Low Engagement' });
      breakdown.lowEngagement.push(m);
    }
    if (reasons.length > 0) {
      atRisk.push({ member: m, reasons, primary: reasons[0], value: price });
    }
  }

  /* ── RECOVER: expired / inactive members by recency ── */
  const recoverSegs = { recent: [], mid: [], old: [] };
  const recover = [];
  for (const m of live) {
    const end = parseDateOnly(m.membership_end);
    const isExpired = m.status === 'expired' || (end && end < today && m.status !== 'deleted');
    if (!isExpired) continue;
    const daysSince = end ? Math.max(0, daysBetween(end, today)) : 999;
    const price = planPriceOf(m);
    let seg, label;
    if (daysSince <= 30) { seg = 'recent'; label = `Expired (${daysSince} days)`; }
    else if (daysSince <= 90) { seg = 'mid'; label = `Inactive (${daysSince} days)`; }
    else { seg = 'old'; label = `Inactive (${daysSince} days)`; }
    recoverSegs[seg].push(m);
    recover.push({ member: m, segment: seg, label, value: price, daysSince });
  }
  recover.sort((a, b) => a.daysSince - b.daysSince);

  /* ── REVENUE: opportunities from real plan prices ── */
  const revenueOpps = [];
  const revBreakdown = { extend: [], upgrade: [] };
  for (const m of active) {
    const end = parseDateOnly(m.membership_end);
    const due = end ? daysBetween(today, end) : (m.days_until_expiry ?? null);
    const price = planPriceOf(m);
    if (due !== null && due >= 0 && due <= 30 && price > 0) {
      revenueOpps.push({ member: m, tag: 'Extend Membership', value: price });
      revBreakdown.extend.push(m);
    }
    if (prices.length >= 2 && price > 0 && price < maxPlanPrice - 0.005) {
      revenueOpps.push({ member: m, tag: 'Upgrade Plan', value: maxPlanPrice - price });
      revBreakdown.upgrade.push(m);
    }
  }
  revenueOpps.sort((a, b) => b.value - a.value);
  // NOTE: PT / nutrition package rows are intentionally omitted — no real
  // package prices exist in the backend, and we never invent prices.

  /* ── Lifecycle donut segments ── */
  const atRiskIds = new Set(atRisk.map((r) => r.member.id));
  const fresh = live.filter((m) => {
    const j = parseDateOnly(m.joined_on);
    return j && j >= monthStart;
  }).length;
  const lifecycle = [
    { key: 'active', label: 'Active', count: active.filter((m) => !atRiskIds.has(m.id)).length, color: RRR_COLORS.revenue },
    { key: 'atrisk', label: 'At Risk', count: atRisk.length, color: RRR_COLORS.retain },
    { key: 'expired', label: 'Expired / Inactive', count: recover.length, color: RRR_COLORS.recover },
    { key: 'new', label: 'New (This Month)', count: fresh, color: '#cbd5e1' },
  ];

  /* ── Stat cards ── */
  const activeWithRecentVisit = active.filter((m) => {
    const ts = visits.get(m.id);
    return ts && ts.some((t) => t >= today.getTime() - 7 * 86400000);
  }).length;
  const stats = {
    totalMembers: live.length,
    totalActive: active.length,
    attendanceRate: hasVisitData && active.length > 0
      ? Math.round((activeWithRecentVisit / active.length) * 100)
      : null, // null = no visit data; UI shows "—", never a fake number
    hasVisitData,
  };

  const sum = (arr) => arr.reduce((s, r) => s + (r.value || 0), 0);

  return {
    stats,
    revenue: {
      meta: RRR_META.revenue,
      opps: revenueOpps,
      potential: sum(revenueOpps),
      breakdown: [
        { label: 'Extend Membership', items: revBreakdown.extend, value: revBreakdown.extend.reduce((s, m) => s + planPriceOf(m), 0) },
        ...(prices.length >= 2
          ? [{ label: 'Upgrade to Premium', items: revBreakdown.upgrade, value: revBreakdown.upgrade.reduce((s, m) => s + (maxPlanPrice - planPriceOf(m)), 0) }]
          : []),
      ],
    },
    retain: {
      meta: RRR_META.retain,
      members: atRisk,
      atRiskValue: atRisk.reduce((s, r) => s + (r.value || 0), 0),
      breakdown: [
        { label: 'Declining Attendance', items: breakdown.declining },
        { label: 'Low Engagement', items: breakdown.lowEngagement },
        { label: 'Plan Ending Soon (≤ 30 days)', items: breakdown.planEnding },
        { label: 'No Visits 14+ Days', items: breakdown.noVisits },
      ],
    },
    recover: {
      meta: RRR_META.recover,
      members: recover,
      lostValue: recover.reduce((s, r) => s + (r.value || 0), 0),
      breakdown: [
        { label: 'Recently Expired (≤ 30 days)', items: recoverSegs.recent },
        { label: 'Inactive (31–90 days)', items: recoverSegs.mid },
        { label: 'Inactive (90+ days)', items: recoverSegs.old },
      ],
    },
    lifecycle,
    maxPlanPrice,
  };
}

/* ─── Donut chart (SVG, no library) ─────────────────────────────────── */
export function donutSVG(segments, size = 148) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = segments.map((s) => {
    const frac = s.count / total;
    const len = Math.max(frac * C - 2, 0.5);
    const el = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${s.color}" stroke-width="20"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${C / 4 - offset}" stroke-linecap="butt"/>`;
    offset += frac * C;
    return el;
  }).join('');
  return `<svg viewBox="0 0 140 140" width="${size}" height="${size}">${arcs}
    <text x="70" y="72" text-anchor="middle" style="font-size:24px;font-weight:800;fill:var(--text)">${fmtInt(total)}</text>
    <text x="70" y="90" text-anchor="middle" style="font-size:11px;fill:var(--text-secondary)">Total Members</text>
  </svg>`;
}

/* ─── Shared row renderers ──────────────────────────────────────────── */
export function avatarFor(name, size = 40) {
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const hues = [152, 24, 210, 32, 262, 12];
  const h = hues[(name || '').length % hues.length];
  return `<span class="rrr-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:hsl(${h} 45% 88%);color:hsl(${h} 45% 32%)">${initials}</span>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
