/* Member Detail Screen */
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderBadge, renderInfoRow, renderSectionHeader, showToast, showConfirm, renderErrorState } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatDate, formatDateTime, formatCurrency, getMemberDisplayStatus, getMemberStatusColor, getDaysText, getInitials, getAvatarColor } from '../utils.js';

export default {
  async mount(el, params) {
    let member = null;
    try {
      if (params?.member) {
        member = typeof params.member === 'string' ? JSON.parse(params.member) : params.member;
      }
    } catch {
      member = null;
    }

    const memberId = member?.id || params?.memberId;
    if (!memberId) {
      el.innerHTML = renderErrorState('Member not found');
      return;
    }

    // Function to render the entire screen with current member state
    const render = () => {
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
              <div style="color:var(--text-secondary);font-size:var(--fs-base);margin-bottom:var(--sp-xs)">${escapeHtml(member.phone)}</div>
              ${member.address ? `
                <div style="color:var(--text-secondary);font-size:var(--fs-sm);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:center;gap:6px">
                  ${icon('location', 16, 'var(--brand)')} <span>${escapeHtml(member.address)}</span>
                </div>
              ` : `
                <div style="color:var(--muted);font-size:var(--fs-xs);margin-bottom:var(--sp-sm)">No address recorded</div>
              `}
              ${renderBadge(status)}
              ${daysText ? `<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:${statusColor.text}">${escapeHtml(daysText)}</div>` : ''}
              <div style="margin-top:var(--sp-md)">
                <button class="btn btn-outline btn-sm" id="btn-quick-edit" style="display:inline-flex;align-items:center;gap:6px">
                  ${icon('edit', 14)} Edit Member
                </button>
              </div>
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

            <!-- Contact & Address Info -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold)">Contact & Address</div>
                  <button class="btn btn-sm btn-link" id="btn-edit-contact" style="padding:0;font-size:var(--fs-xs);color:var(--brand);display:flex;align-items:center;gap:4px">
                    ${icon('edit', 14)} Edit
                  </button>
                </div>
                ${renderInfoRow('Phone', member.phone)}
                ${renderInfoRow('Email', member.email || '—')}
                ${renderInfoRow('Address', member.address || '—')}
                ${renderInfoRow('Gender', member.gender || '—')}
                ${renderInfoRow('Joined', formatDate(member.joined_on))}
                ${member.notes ? renderInfoRow('Notes', member.notes) : ''}
              </div>
            </div>

            <!-- Activity -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Activity & Access</div>
                ${renderInfoRow('Access Status', member.is_inside ? '<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>' : 'Outside')}
                ${member.is_inside && member.last_entry_at ? renderInfoRow('Entered At', formatDateTime(member.last_entry_at)) : ''}
                ${renderInfoRow('WhatsApp', member.whatsapp_opted_in ? 'Opted In' : 'Not opted in')}
                ${renderInfoRow('Biometric', member.has_biometric ? `Enrolled (ID #${escapeHtml(member.device_enroll_number || 'Enrolled')})` : 'Not enrolled')}
              </div>
            </div>

            <!-- Biometric Device Access -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg)">
              <div class="card card-body">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md)">
                  <div style="font-weight:var(--fw-bold);display:flex;align-items:center;gap:var(--sp-xs)">
                    ${icon('access', 18, 'var(--brand)')} Biometric Access (eSSL)
                  </div>
                  ${member.has_biometric ? '<span class="badge badge-success">● Synced</span>' : '<span class="badge badge-muted">Not Enrolled</span>'}
                </div>
                ${member.has_biometric ? `
                  ${renderInfoRow('Machine Enroll ID', `<b style="font-size:var(--fs-lg);color:var(--brand)">#${escapeHtml(member.device_enroll_number || 'Enrolled')}</b>`)}
                  <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                    <button class="btn btn-outline btn-sm btn-full" id="btn-change-enroll" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${icon('edit', 14)} Change ID
                    </button>
                    <button class="btn btn-danger btn-sm btn-full" id="btn-unenroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                      ${icon('delete', 14, 'white')} Unenroll
                    </button>
                  </div>
                ` : `
                  <div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-bottom:var(--sp-md);line-height:1.5">
                    Not enrolled on biometric turnstile or terminal. Assign machine user ID to enable auto-block/unblock and attendance tracking.
                  </div>
                  <button class="btn btn-primary btn-sm btn-full" id="btn-enroll-bio" style="display:flex;align-items:center;justify-content:center;gap:6px">
                    ${icon('access', 16, 'white')} Enroll on Biometric Terminal
                  </button>
                `}
              </div>
            </div>

            <!-- Actions -->
            <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
              <button class="btn ${member.is_inside ? 'btn-secondary' : 'btn-primary'} btn-full" id="btn-checkin" style="font-weight:var(--fw-semibold)">
                ${member.is_inside ? `${icon('back', 18)} Check Out Member` : `${icon('access', 18, 'white')} Check In Member (Attendance)`}
              </button>
              <button class="btn btn-outline btn-full" id="btn-edit-member" style="font-weight:var(--fw-semibold)">
                ${icon('edit', 18)} Edit Member Details
              </button>
              <button class="btn btn-outline btn-full" id="btn-renew">
                ${icon('renewals', 18)} Renew Membership
              </button>
              <button class="btn btn-outline btn-full" id="btn-record-payment">
                ${icon('wallet', 18)} Record Payment
              </button>
              ${member.status === 'paused' ? `
                <button class="btn btn-full" id="btn-unfreeze" style="font-weight:var(--fw-semibold);background:var(--success);color:white;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${icon('check', 18, 'white')} Resume Membership (Unpause)
                </button>
              ` : `
                <button class="btn btn-outline btn-full" id="btn-freeze" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                  ${icon('lock', 18)} Pause / Freeze Membership
                </button>
              `}
              <button class="btn btn-whatsapp btn-full" id="btn-send-reminder">
                ${icon('whatsapp', 18, 'white')} Send WhatsApp Reminder
              </button>
              ${member.status !== 'deleted' ? `
                <button class="btn btn-danger btn-full btn-sm" id="btn-deactivate" style="margin-top:var(--sp-md)">
                  ${icon('delete', 16, 'white')} Deactivate Member
                </button>
              ` : ''}
            </div>
          </div>
        </div>`;

      const openEdit = () => navigate.push('edit-member', { memberId: String(member.id) });

      bindHeaderEvents(el, {
        onBack: () => navigate.pop(),
        actions: [{ onClick: openEdit }],
      });

      el.querySelector('#btn-edit-member')?.addEventListener('click', openEdit);
      el.querySelector('#btn-quick-edit')?.addEventListener('click', openEdit);
      el.querySelector('#btn-edit-contact')?.addEventListener('click', openEdit);

      el.querySelector('#btn-checkin')?.addEventListener('click', async () => {
        const btn = el.querySelector('#btn-checkin');
        const isCheckingOut = member.is_inside;
        btn.disabled = true;
        btn.textContent = isCheckingOut ? 'Checking out...' : 'Checking in...';
        const res = await apiRequest('/api/mobile/v1/access/checkin', {
          method: 'POST',
          body: { member_id: member.id, type: isCheckingOut ? 'EXIT' : 'ENTRY' },
        });
        if (res.ok) {
          member.is_inside = !isCheckingOut;
          showToast(res.data?.message || (isCheckingOut ? `${member.full_name} checked out` : `${member.full_name} checked in!`), 'success');
          render();
        } else {
          showToast(res.error?.message || 'Action failed', 'error');
          btn.disabled = false;
          btn.innerHTML = member.is_inside ? `${icon('back', 18)} Check Out Member` : `${icon('access', 18, 'white')} Check In Member (Attendance)`;
        }
      });

      const promptEnroll = async () => {
        const val = window.prompt(
          `Enter machine Enroll Number (User ID) for ${member.full_name}:`,
          member.device_enroll_number || ''
        );
        if (val === null) return;
        const trimmed = val.trim();
        if (!trimmed) {
          showToast('Please enter an enroll number', 'error');
          return;
        }
        const enrollRes = await apiRequest(`/api/mobile/v1/members/${member.id}/enroll`, {
          method: 'POST',
          body: { enroll_number: trimmed },
        });
        if (enrollRes.ok) {
          showToast(`Biometric ID #${trimmed} saved & synchronized!`, 'success');
          member.has_biometric = true;
          member.device_enroll_number = trimmed;
          render();
        } else {
          showToast(enrollRes.error?.message || 'Enrollment failed', 'error');
        }
      };

      el.querySelector('#btn-enroll-bio')?.addEventListener('click', promptEnroll);
      el.querySelector('#btn-change-enroll')?.addEventListener('click', promptEnroll);

      el.querySelector('#btn-unenroll-bio')?.addEventListener('click', async () => {
        const yes = await showConfirm({
          title: 'Remove Biometric Enrollment?',
          message: `This will unassign device ID #${member.device_enroll_number} and block terminal access for ${member.full_name}.`,
          confirmText: 'Unenroll',
          destructive: true,
        });
        if (!yes) return;
        const unenrollRes = await apiRequest(`/api/mobile/v1/members/${member.id}/unenroll`, {
          method: 'POST',
        });
        if (unenrollRes.ok) {
          showToast('Biometric enrollment removed', 'success');
          member.has_biometric = false;
          member.device_enroll_number = null;
          render();
        } else {
          showToast(unenrollRes.error?.message || 'Failed to unenroll', 'error');
        }
      });

      el.querySelector('#btn-renew')?.addEventListener('click', () => navigate.push('renew-member', { member: JSON.stringify(member) }));
      el.querySelector('#btn-record-payment')?.addEventListener('click', () => navigate.push('record-payment', { memberId: String(member.id) }));

      el.querySelector('#btn-freeze')?.addEventListener('click', async () => {
        const daysStr = window.prompt(`How many days would you like to pause ${member.full_name}'s membership? (e.g. 7, 14, 30)`, '14');
        if (!daysStr) return;
        const days = parseInt(daysStr, 10);
        if (isNaN(days) || days < 1) {
          showToast('Invalid number of days', 'error');
          return;
        }
        const reason = window.prompt('Reason for pause (optional, e.g. Travel, Injury):', '') || '';
        const res = await apiRequest(`/api/mobile/v1/members/${member.id}/freeze`, {
          method: 'POST',
          body: { days, reason }
        });
        if (res.ok) {
          showToast(res.data?.message || 'Membership paused successfully', 'success');
          member = res.data?.data || res.data;
          render();
        } else {
          showToast(res.error?.message || 'Failed to pause membership', 'error');
        }
      });

      el.querySelector('#btn-unfreeze')?.addEventListener('click', async () => {
        const yes = await showConfirm({
          title: 'Resume Membership',
          message: `Resume ${member.full_name}'s membership and restore biometric access?`,
          confirmText: 'Resume',
        });
        if (!yes) return;
        const res = await apiRequest(`/api/mobile/v1/members/${member.id}/unfreeze`, { method: 'POST' });
        if (res.ok) {
          showToast('Membership resumed!', 'success');
          member = res.data?.data || res.data;
          render();
        } else {
          showToast(res.error?.message || 'Failed to resume membership', 'error');
        }
      });

      el.querySelector('#btn-send-reminder')?.addEventListener('click', async () => {
        const res = await apiRequest('/api/mobile/v1/whatsapp/send-reminder', { method: 'POST', body: { member_id: member.id } });
        showToast(res.ok ? 'Reminder sent!' : res.error.message, res.ok ? 'success' : 'error');
      });

      el.querySelector('#btn-deactivate')?.addEventListener('click', async () => {
        const yes = await showConfirm({
          title: 'Deactivate Member',
          message: `Are you sure you want to deactivate ${member.full_name}?`,
          confirmText: 'Deactivate',
          destructive: true
        });
        if (!yes) return;
        const res = await apiRequest(`/api/mobile/v1/members/${member.id}/deactivate`, { method: 'POST' });
        if (res.ok) {
          showToast('Member deactivated', 'success');
          navigate.pop();
        } else {
          showToast(res.error.message, 'error');
        }
      });
    };

    // If we have initial data, render immediately
    if (member) {
      render();
    } else {
      el.innerHTML = '<div style="padding:48px;text-align:center">Loading member details…</div>';
    }

    // Refresh from API to ensure address and latest data are up to date
    const res = await apiRequest(`/api/mobile/v1/members/${memberId}`);
    if (res.ok) {
      member = res.data;
      render();
    } else if (!member) {
      el.innerHTML = renderErrorState(res.error?.message || 'Member not found');
      return;
    }

    // Listen for member updates from edit-member screen
    const onMemberUpdated = (e) => {
      if (e?.detail && String(e.detail.id) === String(memberId)) {
        member = e.detail;
        render();
      }
    };
    window.addEventListener('member-updated', onMemberUpdated);
  }
};
