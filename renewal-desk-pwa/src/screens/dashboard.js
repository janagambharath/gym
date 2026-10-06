/* ═══════════════════════════════════════════════════════════════════════
   Dashboard Screen — RRR Gym Growth System
   Revenue. Retain. Recover. All figures computed client-side from real
   member / plan / visit data (see ../rrr.js). Nothing is hardcoded.
   ═══════════════════════════════════════════════════════════════════════ */

import { getCachedSession } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { icon } from '../icons.js';
import { renderErrorState, showToast } from '../components.js';
import { BRAND, RRR_META, fetchRRRData, computeRRR, donutSVG, avatarFor, fmtINR, fmtInt, esc } from '../rrr.js';

/** @type {import('../router.js').Screen} */
export default {
  async mount(el) {
    const session = getCachedSession();
    const gymName = session?.tenantName || 'Your Gym';
    const userName = session?.userName || '';

    el.innerHTML = `
      <div class="rrr-page">
        <div class="rrr-topbar">
          <div class="rrr-brand">
            <span class="rrr-logo"><span class="rrr-logo-accent">R</span>RR</span>
            <span class="rrr-brand-sub">${esc(BRAND.tagline)}</span>
          </div>
          <div class="rrr-gym-pill">
            <span>${esc(gymName)}</span>
            ${icon('chevronDown', 14, '#64748b')}
          </div>
          <button class="rrr-icon-btn" id="rrr-bell" aria-label="Notifications">
            ${icon('notifications', 20)}<span class="dot"></span>
          </button>
          <button class="rrr-avatar-btn" id="rrr-avatar" aria-label="Account">
            ${esc((userName || gymName || 'G').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}
          </button>
        </div>
        <div class="scroll-view" id="rrr-scroll">
          <div style="padding:16px">
            <div class="rrr-skel" style="height:34px;width:75%;margin-bottom:10px"></div>
            <div class="rrr-skel" style="height:110px;margin-bottom:10px"></div>
            <div class="rrr-skel" style="height:170px;margin-bottom:10px"></div>
            <div class="rrr-skel" style="height:170px"></div>
          </div>
        </div>
      </div>`;

    el.querySelector('#rrr-bell')?.addEventListener('click', () => navigate.push('notifications'));
    el.querySelector('#rrr-avatar')?.addEventListener('click', () => navigate.switchTab('more'));

    await loadRrrDashboard(el);
  },
};

async function loadRrrDashboard(el) {
  const scroll = el.querySelector('#rrr-scroll');
  if (!scroll) return;

  const res = await fetchRRRData();
  if (!res.ok) {
    scroll.innerHTML = `<div style="padding:24px">${renderErrorState(res.error.message, 'rrr-retry')}</div>`;
    scroll.querySelector('#rrr-retry')?.addEventListener('click', () => loadRrrDashboard(el));
    if (res.error.status === 401) handleLogout();
    return;
  }

  const rrr = computeRRR(res.members, res.plans, res.visits);
  const revenue30d = res.summary ? parseFloat(res.summary.revenue?.collected || '0') || 0 : 0;

  const statCard = (value, label, ico, bg, fg) => `
    <div class="rrr-stat">
      <div class="rrr-stat-top"><span class="rrr-stat-ico" style="background:${bg}">${icon(ico, 16, fg)}</span></div>
      <div class="rrr-stat-value">${value}</div>
      <div class="rrr-stat-label">${label}</div>
    </div>`;

  const fwCard = (meta, count, countLabel, money, moneyLabel, tab) => `
    <div class="rrr-fw-card ${meta.key === 'revenue' ? 'green' : meta.key === 'retain' ? 'orange' : 'red'}">
      <div class="rrr-fw-head">
        <span class="rrr-fw-ico">${icon(meta.icon, 22, meta.color)}</span>
        <div><div class="rrr-fw-title">${meta.title}</div><div class="rrr-fw-sub">${meta.subtitle}</div></div>
      </div>
      <div class="rrr-fw-body">
        <div><div class="rrr-fw-count">${fmtInt(count)}</div><div class="rrr-fw-count-label">${countLabel}</div></div>
        <div class="rrr-fw-money"><div class="amt">${money}</div><div class="lbl">${moneyLabel}</div></div>
      </div>
      <button class="rrr-viewall" data-goto="${tab}">View All ${icon('forward', 16)}</button>
    </div>`;

  const oppRow = (o) => `
    <button class="rrr-row" data-member='${esc(JSON.stringify({ id: o.member.id }))}'>
      ${avatarFor(o.member.full_name)}
      <span class="rrr-row-main">
        <span class="rrr-row-name">${esc(o.member.full_name)}</span><br>
        <span class="rrr-tag green">${esc(o.tag)}</span>
      </span>
      <span class="rrr-row-amt">${fmtINR(o.value)}</span>
      <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
    </button>`;

  const riskRow = (r) => `
    <button class="rrr-row" data-member='${esc(JSON.stringify({ id: r.member.id }))}'>
      ${avatarFor(r.member.full_name)}
      <span class="rrr-row-main">
        <span class="rrr-row-name">${esc(r.member.full_name)}</span><br>
        <span class="rrr-tag ${r.primary.key === 'plan_ending' ? 'orange' : 'red'}">${esc(r.primary.label)}</span>
      </span>
      <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
    </button>`;

  const recRow = (r) => `
    <button class="rrr-row" data-member='${esc(JSON.stringify({ id: r.member.id }))}'>
      ${avatarFor(r.member.full_name)}
      <span class="rrr-row-main">
        <span class="rrr-row-name">${esc(r.member.full_name)}</span><br>
        <span class="rrr-tag red">${esc(r.label)}</span>
      </span>
      <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
    </button>`;

  const listBlock = (title, rows, tab, emptyText) => `
    <div class="rrr-list-head"><h3>${title}</h3><button class="rrr-link" data-goto="${tab}">View All</button></div>
    <div class="rrr-rows">${rows.length ? rows.slice(0, 4).map((r) => r.html).join('') : `<div class="rrr-empty">${emptyText}</div>`}</div>`;

  const total = rrr.lifecycle.reduce((s, x) => s + x.count, 0);

  scroll.innerHTML = `
    <div class="rrr-hero">
      <h1>${esc(BRAND.headline)}</h1>
      <p>${esc(BRAND.subhead)}</p>
    </div>

    <div class="rrr-stats">
      ${statCard(fmtInt(rrr.stats.totalMembers), 'Total Members', 'members', '#eef2ff', '#4f46e5')}
      ${statCard(rrr.stats.attendanceRate === null ? '—' : rrr.stats.attendanceRate + '%', 'Attendance Rate', 'check', '#e8f7ee', '#16a34a')}
      ${statCard(fmtINR(revenue30d), 'Revenue · 30 days', 'cash', '#e8f7ee', '#16a34a')}
    </div>
    ${!rrr.stats.hasVisitData ? `<div class="rrr-note">No biometric visit data yet — attendance-based risk appears once the bridge syncs check-ins.</div>` : ''}

    <div class="rrr-fw">
      ${fwCard(RRR_META.revenue, rrr.revenue.opps.length, 'Revenue Opportunities', '~ ' + fmtINR(rrr.revenue.potential), 'potential revenue', 'revenue')}
      ${fwCard(RRR_META.retain, rrr.retain.members.length, 'At Risk Members', '~ ' + fmtINR(rrr.retain.atRiskValue), 'potential revenue at risk', 'retain')}
      ${fwCard(RRR_META.recover, rrr.recover.members.length, 'Inactive / Expired Members', '~ ' + fmtINR(rrr.recover.lostValue), 'lost potential revenue', 'recover')}
    </div>

    <div class="rrr-card">
      <h3>Member Lifecycle</h3>
      <div class="rrr-donut-wrap">
        ${donutSVG(rrr.lifecycle)}
        <div class="rrr-legend">
          ${rrr.lifecycle.map((s) => `
            <div class="rrr-legend-row">
              <span class="rrr-legend-dot" style="background:${s.color}"></span>${esc(s.label)}
              <b>${fmtInt(s.count)}</b><span class="pct">${total ? Math.round((s.count / total) * 100) : 0}%</span>
            </div>`).join('')}
        </div>
      </div>
    </div>

    ${listBlock('Top Revenue Opportunities', rrr.revenue.opps.map((o) => ({ html: oppRow(o) })), 'revenue', 'No priced opportunities right now.')}
    ${listBlock('At Risk Members', rrr.retain.members.map((r) => ({ html: riskRow(r) })), 'retain', 'No at-risk members. 🎉')}
    ${listBlock('Inactive / Expired Members', rrr.recover.members.map((r) => ({ html: recRow(r) })), 'recover', 'No inactive or expired members.')}

    <div class="rrr-bottom-pad"></div>`;

  scroll.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => navigate.switchTab(b.dataset.goto))
  );
  scroll.querySelectorAll('[data-member]').forEach((row) =>
    row.addEventListener('click', () => {
      try {
        const { id } = JSON.parse(row.dataset.member);
        const m = res.members.find((x) => String(x.id) === String(id));
        if (m) navigate.push('member-detail', { member: JSON.stringify(m) });
        else showToast('Member not found', 'error');
      } catch { /* ignore */ }
    })
  );
}
