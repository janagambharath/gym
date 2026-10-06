/* ═══════════════════════════════════════════════════════════════════════
   RRR section screens — Revenue / Retain / Recover tabs.
   Full filtered views of the dashboard lists (breakdown rows + all rows).
   ═══════════════════════════════════════════════════════════════════════ */

import { getCachedSession } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { icon } from '../icons.js';
import { renderErrorState, showToast } from '../components.js';
import { BRAND, RRR_META, fetchRRRData, computeRRR, avatarFor, fmtINR, fmtInt, esc } from '../rrr.js';

/**
 * @param {'revenue'|'retain'|'recover'} kind
 * @returns {import('../router.js').Screen}
 */
export function makeSectionScreen(kind) {
  const meta = RRR_META[kind];
  return {
    async mount(el) {
      const session = getCachedSession();
      const gymName = session?.tenantName || 'Your Gym';

      el.innerHTML = `
        <div class="rrr-page">
          <div class="rrr-topbar">
            <div class="rrr-brand">
              <span class="rrr-logo"><span class="rrr-logo-accent">R</span>RR</span>
              <span class="rrr-brand-sub">${esc(BRAND.tagline)}</span>
            </div>
            <div class="rrr-gym-pill"><span>${esc(gymName)}</span></div>
          </div>
          <div class="scroll-view" id="rrr-sec-scroll">
            <div style="padding:16px">
              <div class="rrr-skel" style="height:120px;margin-bottom:10px"></div>
              <div class="rrr-skel" style="height:220px"></div>
            </div>
          </div>
        </div>`;
      await loadSection(el, kind);
    },
  };
}

async function loadSection(el, kind) {
  const scroll = el.querySelector('#rrr-sec-scroll');
  if (!scroll) return;
  const meta = RRR_META[kind];

  const res = await fetchRRRData();
  if (!res.ok) {
    scroll.innerHTML = `<div style="padding:24px">${renderErrorState(res.error.message, 'rrr-sec-retry')}</div>`;
    scroll.querySelector('#rrr-sec-retry')?.addEventListener('click', () => loadSection(el, kind));
    if (res.error.status === 401) handleLogout();
    return;
  }
  const rrr = computeRRR(res.members, res.plans, res.visits);
  const data = rrr[kind];

  let hero, breakdownRows = '', listTitle, rowsHtml = '', emptyText;

  if (kind === 'revenue') {
    hero = [`${fmtInt(data.opps.length)}`, 'Revenue Opportunities', '~ ' + fmtINR(data.potential), 'potential revenue'];
    listTitle = `Top Revenue Opportunities (${data.opps.length})`;
    emptyText = 'No priced opportunities right now.';
    breakdownRows = data.breakdown.map((b) => bdRow(b.label, b.items.length, fmtINR(b.value), meta)).join('');
    rowsHtml = data.opps.map((o) => `
      <button class="rrr-row" data-member='${esc(JSON.stringify({ id: o.member.id }))}'>
        ${avatarFor(o.member.full_name)}
        <span class="rrr-row-main"><span class="rrr-row-name">${esc(o.member.full_name)}</span><br>
        <span class="rrr-tag green">${esc(o.tag)}</span></span>
        <span class="rrr-row-amt">${fmtINR(o.value)}</span>
        <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
      </button>`).join('');
  } else if (kind === 'retain') {
    hero = [`${fmtInt(data.members.length)}`, 'At Risk Members', '~ ' + fmtINR(data.atRiskValue), 'potential revenue at risk'];
    listTitle = `At Risk Members (${data.members.length})`;
    emptyText = 'No at-risk members. 🎉';
    breakdownRows = data.breakdown.map((b) => bdRow(b.label, b.items.length, '', meta)).join('');
    rowsHtml = data.members.map((r) => `
      <button class="rrr-row" data-member='${esc(JSON.stringify({ id: r.member.id }))}'>
        ${avatarFor(r.member.full_name)}
        <span class="rrr-row-main"><span class="rrr-row-name">${esc(r.member.full_name)}</span><br>
        <span class="rrr-tag orange">${esc(r.primary.label)}</span>
        ${r.reasons.length > 1 ? `<span class="rrr-tag red" style="margin-left:4px">+${r.reasons.length - 1}</span>` : ''}</span>
        <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
      </button>`).join('');
  } else {
    hero = [`${fmtInt(data.members.length)}`, 'Inactive / Expired Members', '~ ' + fmtINR(data.lostValue), 'lost potential revenue'];
    listTitle = `Inactive / Expired Members (${data.members.length})`;
    emptyText = 'No inactive or expired members.';
    breakdownRows = data.breakdown.map((b) => bdRow(b.label, b.items.length, '', meta)).join('');
    rowsHtml = data.members.map((r) => `
      <button class="rrr-row" data-member='${esc(JSON.stringify({ id: r.member.id }))}'>
        ${avatarFor(r.member.full_name)}
        <span class="rrr-row-main"><span class="rrr-row-name">${esc(r.member.full_name)}</span><br>
        <span class="rrr-tag red">${esc(r.label)}</span></span>
        <span class="rrr-row-chev">${icon('chevronRight', 18)}</span>
      </button>`).join('');
  }

  scroll.innerHTML = `
    <div class="rrr-section-head">
      <div class="rrr-fw-head" style="margin-bottom:10px">
        <span class="rrr-fw-ico" style="background:${meta.soft}">${icon(meta.icon, 22, meta.color)}</span>
        <div><div class="rrr-fw-title" style="color:${meta.color}">${meta.title}</div>
        <div class="rrr-fw-sub">${meta.subtitle}</div></div>
      </div>
    </div>
    <div class="rrr-fw" style="padding-top:0">
      <div class="rrr-fw-card ${kind === 'revenue' ? 'green' : kind === 'retain' ? 'orange' : 'red'}">
        <div class="rrr-fw-body" style="margin-top:0">
          <div><div class="rrr-fw-count">${hero[0]}</div><div class="rrr-fw-count-label">${hero[1]}</div></div>
          <div class="rrr-fw-money"><div class="amt">${hero[2]}</div><div class="lbl">${hero[3]}</div></div>
        </div>
      </div>
    </div>
    ${breakdownRows ? `<div class="rrr-breakdown">${breakdownRows}</div>` : ''}
    <div class="rrr-list-head"><h3>${esc(listTitle)}</h3></div>
    <div class="rrr-rows">${rowsHtml || `<div class="rrr-empty">${emptyText}</div>`}</div>
    ${kind === 'retain' && !rrr.stats.hasVisitData
      ? `<div class="rrr-note">Visit-based risk (No Visits 14+ Days, Declining Attendance, Low Engagement) appears once the biometric bridge syncs check-ins.</div>` : ''}
    <div class="rrr-bottom-pad"></div>`;

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

function bdRow(label, n, value, meta) {
  return `<div class="rrr-bd-row"><span class="n" style="color:${meta.color}">${fmtInt(n)}</span>
    <span>${esc(label)}</span>${value ? `<span class="v">${esc(value)}</span>` : ''}
    <span class="chev">${icon('chevronRight', 16)}</span></div>`;
}
