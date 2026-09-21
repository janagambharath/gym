/* Member Home Screen */
import { apiRequest } from '../../api.js'; import { navigate } from '../../app.js';
import { renderHeader, renderBadge, renderMenuItem, renderMetricCard } from '../../components.js';
import { icon } from '../../icons.js'; import { formatDate, formatCurrency, getDaysText, escapeHtml, formatInteger } from '../../utils.js';
export default { async mount(el) {
  const res = await apiRequest('/api/member/v1/home');
  const d = res.ok ? res.data : {};
  const m = d.membership || {};
  el.innerHTML = `${renderHeader({title:'My Gym'})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="padding:var(--sp-xxl);text-align:center;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:white;border-radius:0 0 var(--r-xxl) var(--r-xxl)">
        <h2 style="color:white;margin-bottom:var(--sp-sm)">${escapeHtml(d.member_name||'Member')}</h2>
        <div style="font-size:var(--fs-sm);opacity:0.9;margin-bottom:var(--sp-lg)">${escapeHtml(d.gym_name||'')}</div>
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold)">${m.days_remaining!=null?m.days_remaining:'—'}</div>
        <div style="font-size:var(--fs-sm);opacity:0.8">days remaining</div>
        ${m.status ? `<div style="margin-top:var(--sp-md)">${renderBadge(m.status)}</div>` : ''}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
        <div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${escapeHtml(m.plan_name||'—')}</span></div>
        <div class="info-row"><span class="info-row-label">Valid Until</span><span class="info-row-value">${formatDate(m.end_date)}</span></div>
      </div></div>
      <div class="card" style="margin:0 var(--sp-lg) var(--sp-lg)">
        ${renderMenuItem({iconName:'person',label:'My Profile',onClick:'member-profile',iconBg:'var(--brand-subtle)',iconColor:'var(--brand)'})}
        ${renderMenuItem({iconName:'calendar',label:'Membership',onClick:'member-membership',iconBg:'var(--success-surface)',iconColor:'var(--success)'})}
        ${renderMenuItem({iconName:'wallet',label:'Payments',onClick:'member-payments',iconBg:'var(--status-pending-surface)',iconColor:'var(--status-pending)'})}
        ${renderMenuItem({iconName:'access',label:'Attendance',onClick:'member-access',iconBg:'#fce7f3',iconColor:'#db2777'})}
      </div>
      ${m.days_remaining!=null&&m.days_remaining<=7 ? `<div style="padding:0 var(--sp-lg) var(--sp-lg)">
        <button class="btn btn-primary btn-lg btn-full" id="mh-renew">${icon('renewals',18,'white')} Renew Now</button>
      </div>` : ''}
    </div></div>`;
  el.querySelectorAll('[data-action]').forEach(i=>i.addEventListener('click',()=>navigate.push(i.dataset.action)));
  el.querySelector('#mh-renew')?.addEventListener('click',()=>navigate.push('member-renew'));
}};
