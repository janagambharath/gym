/* Member Detail Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderBadge, renderInfoRow, renderSectionHeader, showToast, showConfirm, renderErrorState } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatDate, formatCurrency, getMemberDisplayStatus, getMemberStatusColor, getDaysText, getInitials, getAvatarColor } from '../utils.js';

export default {
  async mount(el, params) {
    let member = params?.member ? JSON.parse(params.member) : null;
    if (!member) { el.innerHTML = renderErrorState('Member not found'); return; }

    // Refresh from API
    const res = await apiRequest(`/api/mobile/v1/members/${member.id}`);
    if (res.ok) member = res.data;

    const status = getMemberDisplayStatus(member);
    const statusColor = getMemberStatusColor(status);
    const daysText = getDaysText(member.days_until_expiry);

    el.innerHTML = `
      ${renderHeader({ title: 'Member', showBack: true, actions: [{ icon: 'edit', label: 'Edit' }] })}
      <div class="scroll-view">
        <div class="scroll-content">
          <!-- Profile Card -->
          <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
            <div style="display:inline-flex">${renderAvatar(member.full_name, 'xl')}</div>
            <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${escapeHtml(member.full_name)}</h2>
            <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-md)">${escapeHtml(member.phone)}</div>
            ${renderBadge(status)}
            ${daysText ? `<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${statusColor.text}">${escapeHtml(daysText)}</div>` : ''}
          </div>

          <!-- Membership Info -->
          <div style="padding:var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership</div>
              ${renderInfoRow('Plan', member.plan?.name || '—')}
              ${renderInfoRow('Start', formatDate(member.membership_start))}
              ${renderInfoRow('End', formatDate(member.membership_end))}
              ${member.days_until_expiry != null ? `
                <div style="margin-top:var(--sp-md)">
                  <div class="progress-bar">
                    <div class="progress-bar-fill" style="width:${Math.max(0, Math.min(100, (member.days_until_expiry / (member.plan?.duration_days || 30)) * 100))}%;background:${statusColor.text}"></div>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Contact Info -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Contact</div>
              ${renderInfoRow('Phone', member.phone)}
              ${renderInfoRow('Email', member.email || '—')}
              ${renderInfoRow('Gender', member.gender || '—')}
              ${renderInfoRow('Joined', formatDate(member.joined_on))}
              ${member.notes ? renderInfoRow('Notes', member.notes) : ''}
            </div>
          </div>

          <!-- Activity -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg)">
            <div class="card card-body">
              <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity</div>
              ${renderInfoRow('WhatsApp', member.whatsapp_opted_in ? 'Opted In' : 'Not opted in')}
              ${renderInfoRow('Biometric', member.has_biometric ? 'Enrolled' : 'Not enrolled')}
            </div>
          </div>

          <!-- Actions -->
          <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
            <button class="btn btn-primary btn-full" id="btn-renew">${icon('renewals', 18, 'white')} Renew Membership</button>
            <button class="btn btn-outline btn-full" id="btn-record-payment">${icon('wallet', 18)} Record Payment</button>
            <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">${icon('whatsapp', 18, 'white')} Send WhatsApp Reminder</button>
            ${member.status !== 'deleted' ? `<button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">${icon('delete', 16, 'white')} Deactivate Member</button>` : ''}
          </div>
        </div>
      </div>`;

    bindHeaderEvents(el, {
      onBack: () => navigate.pop(),
      actions: [{ onClick: () => navigate.push('edit-member', { memberId: String(member.id) }) }],
    });

    el.querySelector('#btn-renew')?.addEventListener('click', () => navigate.push('renew-member', { member: JSON.stringify(member) }));
    el.querySelector('#btn-record-payment')?.addEventListener('click', () => navigate.push('record-payment', { memberId: String(member.id) }));

    el.querySelector('#btn-send-reminder')?.addEventListener('click', async () => {
      const res = await apiRequest('/api/mobile/v1/whatsapp/send-reminder', { method: 'POST', body: { member_id: member.id } });
      showToast(res.ok ? 'Reminder sent!' : res.error.message, res.ok ? 'success' : 'error');
    });

    el.querySelector('#btn-deactivate')?.addEventListener('click', async () => {
      const yes = await showConfirm({ title: 'Deactivate Member', message: `Are you sure you want to deactivate ${member.full_name}?`, confirmText: 'Deactivate', destructive: true });
      if (!yes) return;
      const res = await apiRequest(`/api/mobile/v1/members/${member.id}/deactivate`, { method: 'POST' });
      if (res.ok) { showToast('Member deactivated', 'success'); navigate.pop(); }
      else showToast(res.error.message, 'error');
    });
  }
};
