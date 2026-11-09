/* Member Detail Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderBadge, renderInfoRow, renderInfoRowHtml, renderSectionHeader, showToast, showConfirm, showPrompt, renderErrorState } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml, formatDate, formatDateTime, formatCurrency, getMemberDisplayStatus, getMemberStatusColor, getDaysText, getInitials, getAvatarColor, uuid } from '../utils.js';

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

    // V10-L13/L25: one stable idempotency key per pending reminder send.
    // A re-tap after a failed or lost send reuses the key (the backend
    // replays scope whatsapp_send_reminder instead of sending twice);
    // the key rotates after a successful send so a later deliberate
    // reminder is a new action, not a replay.
    let reminderKey = uuid();

    // Function to render the entire screen with current member state
    const render = () => {
      const status = getMemberDisplayStatus(member);
      const statusColor = getMemberStatusColor(status);
      const daysText = getDaysText(member.days_until_expiry);

      // V6-M8/M9: after a failed command the door state is UNKNOWN, and a
      // stale queued command is NOT blocked-as-fact — never present
      // door_blocked as current truth in either state.
      const doorFailed = member.door_access_failed === true;
      const doorStaleQueued = member.door_access_stale_queued === true;
      const doorFailedAction = member.door_access_failed_action === 'block' || member.door_access_failed_action === 'unblock'
        ? member.door_access_failed_action
        : null;
      const doorToggleLabel = doorFailed
        ? `Retry ${doorFailedAction === 'unblock' ? 'Unblock' : 'Block'} Access`
        : member.door_blocked ? 'Unblock Biometric Access' : 'Block Biometric Access';
      const doorAccessStateHtml = doorFailed
        ? `Failed — tap to retry ${escapeHtml(doorFailedAction || 'the access change')}${member.door_access_error ? `: ${escapeHtml(member.door_access_error)}` : ''}.`
        : doorStaleQueued
          ? `Queued — terminal hasn't checked in since ${escapeHtml(formatDateTime(member.door_access_terminal_last_seen_at || member.door_access_queued_since))}.`
          : member.door_access_pending
            ? `Waiting for the terminal to confirm ${escapeHtml(member.door_access_pending_action || 'the access change')}.`
            : member.door_access_error ? escapeHtml(member.door_access_error) : '';

      el.innerHTML = `
        ${renderHeader({ title: 'Member', showBack: true, actions: [{ icon: 'edit', label: 'Edit' }] })}
        ${staleRefresh ? `<div id="md-stale-banner" style="padding:var(--sp-sm) var(--sp-lg);background:var(--warning-surface,#fef3c7);color:var(--warning,#92400e);font-size:var(--fs-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm)"><span>Showing saved details — refresh failed${refreshError ? `: ${escapeHtml(refreshError)}` : '.'}</span><button class="btn btn-sm btn-secondary" id="md-refresh-retry">Try again</button></div>` : ''}
        <div class="scroll-view">
          <div class="scroll-content">
            <!-- Profile Card -->
            <div style="padding:var(--sp-xxl);text-align:center;background:var(--card);border-bottom:1px solid var(--border-light)">
              <div style="display:inline-flex">${renderAvatar(member.full_name, 'xl')}</div>
              <h2 style="font-size:var(--fs-3xl);margin-top:var(--sp-md);margin-bottom:var(--sp-xs)">${escapeHtml(member.full_name)}</h2>
              <div style="margin-bottom:var(--sp-md);display:flex;gap:var(--sp-sm);justify-content:center">
                <a href="tel:${escapeHtml(member.phone)}" class="btn btn-secondary" style="text-decoration:none">${icon('phone', 16)} Call</a>
                <a href="https://wa.me/${escapeHtml(String(member.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener" class="btn btn-whatsapp" style="text-decoration:none">${icon('whatsapp', 16, 'white')} WhatsApp</a>
              </div>
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
                ${renderInfoRowHtml('Access Status', member.is_inside ? '<span style="color:var(--success);font-weight:var(--fw-bold)">● Inside Gym Now</span>' : 'Outside')}
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
                  ${renderInfoRow('Machine Enroll ID', `#${member.device_enroll_number || '—'}`)}
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
              <button class="btn btn-outline btn-full" id="btn-renewal-history">
                ${icon('time', 18)} Renewal History
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
              <button class="btn btn-outline btn-full" id="btn-toggle-access" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${icon('lock', 18)} <span id="btn-toggle-access-label">${escapeHtml(doorToggleLabel)}</span>
              </button>
              <div class="form-hint" id="door-access-state" role="status">${doorAccessStateHtml}</div>
              <button class="btn btn-outline btn-full" id="btn-biometric-records" style="font-weight:var(--fw-semibold);display:flex;align-items:center;justify-content:center;gap:var(--sp-xs)">
                ${icon('clock', 18)} Biometric Records
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

      // V8-L20: a failed refresh on cached member data used to keep stale
      // data silently. The banner above (rendered when staleRefresh is
      // set) carries the retry.
      el.querySelector('#md-refresh-retry')?.addEventListener('click', () => refreshMember());

      el.querySelector('#btn-edit-member')?.addEventListener('click', openEdit);
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
        // V6-M14: the backend returns HTTP 200 success:true with the denial
        // only in the top-level message + data.event_type — do NOT flip
        // is_inside or toast success on a denial.
        if (res.ok && res.data?.event_type === 'ACCESS_DENIED') {
          showToast(res.message || res.data?.message || `${member.full_name} was denied access — membership is not active.`, 'error');
          btn.disabled = false;
          btn.innerHTML = member.is_inside ? `${icon('back', 18)} Check Out Member` : `${icon('access', 18, 'white')} Check In Member (Attendance)`;
        } else if (res.ok) {
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
        const val = await showPrompt({
          title: 'Enroll Number',
          message: `Enter machine Enroll Number (User ID) for ${member.full_name}:`,
          placeholder: 'e.g. 101',
          defaultValue: member.device_enroll_number || '',
          inputType: 'text',
          confirmText: 'Save',
        });
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
      el.querySelector('#btn-renewal-history')?.addEventListener('click', () => navigate.push('member-history', { memberId: String(member.id) }));

      // Block / unblock biometric access (terminal command: direct-ADMS or bridge).
      // The initial label reflects the member's actual door state (server-computed).
      let accessBlocked = member.door_blocked === true;
      el.querySelector('#btn-toggle-access')?.addEventListener('click', async () => {
        // V6-M8: retry re-issues the failed action — the toggle state is
        // stale/unknown after a failure, so it must not pick the action.
        const retrying = member.door_access_failed === true
          && (member.door_access_failed_action === 'block' || member.door_access_failed_action === 'unblock');
        const action = retrying ? member.door_access_failed_action : accessBlocked ? 'unblock' : 'block';
        const yes = await showConfirm({
          title: retrying
            ? `Retry ${action === 'block' ? 'Block' : 'Unblock'} Biometric Access`
            : action === 'block' ? 'Block Biometric Access' : 'Unblock Biometric Access',
          message: action === 'block'
            ? `${member.full_name} will not be able to enter with their fingerprint until unblocked.`
            : `${member.full_name} will be able to enter with their fingerprint again.`,
          confirmText: action === 'block' ? 'Block Access' : 'Unblock Access',
          destructive: action === 'block',
        });
        if (!yes) return;
        const btn = el.querySelector('#btn-toggle-access');
        btn.disabled = true;
        const res = await apiRequest(`/api/mobile/v1/rrr/members/${member.id}/access`, { method: 'POST', body: { action } });
        btn.disabled = false;
        if (res.ok) {
          accessBlocked = action === 'block';
          member.door_blocked = accessBlocked;
          member.door_access_pending = Boolean(res.data?.command);
          member.door_access_pending_action = action;
          member.door_access_error = null;
          // V6-M8/M9: the fresh command supersedes the failed / stale state.
          member.door_access_failed = false;
          member.door_access_failed_action = null;
          member.door_access_failed_at = null;
          member.door_access_stale_queued = false;
          member.door_access_queued_since = null;
          el.querySelector('#btn-toggle-access-label').textContent = accessBlocked ? 'Unblock Biometric Access' : 'Block Biometric Access';
          el.querySelector('#door-access-state').textContent = member.door_access_pending
            ? `Waiting for the terminal to confirm ${action}.`
            : '';
          const queuedMsg = res.data?.connector === 'bridge'
            ? 'Command queued — the bridge applies it on its next poll.'
            : 'Command queued — the terminal applies it on its next check-in.';
          showToast(res.data?.command ? queuedMsg : `${action === 'block' ? 'Blocked' : 'Unblocked'}.`, 'success');
        } else {
          el.querySelector('#door-access-state').textContent = res.error?.message || '';
          showToast(res.error?.message || `Could not ${action} access`, 'error');
        }
      });

      el.querySelector('#btn-biometric-records')?.addEventListener('click', () => {
        navigate.push('member-attendance', { id: member.id });
      });

      el.querySelector('#btn-freeze')?.addEventListener('click', async () => {
        const daysStr = await showPrompt({
          title: 'Pause Membership',
          message: `How many days would you like to pause ${member.full_name}'s membership?`,
          placeholder: 'e.g. 7, 14, 30',
          defaultValue: '14',
          inputType: 'number',
          confirmText: 'Continue',
        });
        if (!daysStr) return;
        const days = parseInt(daysStr, 10);
        if (isNaN(days) || days < 1) {
          showToast('Invalid number of days', 'error');
          return;
        }
        const reason = await showPrompt({
          title: 'Pause Reason',
          message: 'Reason for pause (optional):',
          placeholder: 'e.g. Travel, Injury',
          defaultValue: '',
          confirmText: 'Pause Membership',
        }) || '';
        const res = await apiRequest(`/api/mobile/v1/members/${member.id}/freeze`, {
          method: 'POST',
          body: { days, reason }
        });
        if (res.ok) {
          // V10-L24: the backend puts the human message top-level
          // (res.message), not res.data.message — the old read always
          // fell back to the generic text instead of e.g. "paused for
          // 14 days. Gate access disabled."
          showToast(res.message || res.data?.message || 'Membership paused successfully', 'success');
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
          // V10-L24: same top-level-message shape as freeze.
          showToast(res.message || res.data?.message || 'Membership resumed!', 'success');
          member = res.data?.data || res.data;
          render();
        } else {
          showToast(res.error?.message || 'Failed to resume membership', 'error');
        }
      });

      el.querySelector('#btn-send-reminder')?.addEventListener('click', async () => {
        // V10-L13: no in-flight guard used to let a double-tap send two
        // reminders (apiRequest mints a fresh key per call). Disable
        // while the POST is in flight; re-enable on failure.
        const btn = el.querySelector('#btn-send-reminder');
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        const res = await apiRequest('/api/mobile/v1/whatsapp/send-reminder', { method: 'POST', body: { member_id: member.id }, headers: { 'Idempotency-Key': reminderKey } });
        if (res.ok) {
          showToast('Reminder sent!', 'success');
          reminderKey = uuid();
        } else {
          showToast(res.error.message, 'error');
        }
        btn.disabled = false;
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

    // V8-L20: refresh the member from the API, distinguishing a genuine
    // 404 ("Member not found", no retry) from any other load failure
    // (error + retry), and flagging stale cached data instead of silently
    // keeping it.
    let staleRefresh = false;
    let refreshError = null;
    const refreshMember = async (background = false) => {
      const r = await apiRequest(`/api/mobile/v1/members/${memberId}`);
      if (r.ok) {
        member = r.data;
        staleRefresh = false;
        refreshError = null;
        render();
        return true;
      }
      if (!member) {
        if (r.error?.status === 404) {
          // Genuine 404: no retry — retrying a missing member is pointless.
          el.innerHTML = '<div class="empty-state"><div class="empty-state-title">Member not found</div></div>';
        } else {
          el.innerHTML = renderErrorState(r.error?.message || 'Could not load this member.');
          el.querySelector('#retry-btn')?.addEventListener('click', () => refreshMember());
        }
        return false;
      }
      staleRefresh = true;
      refreshError = r.error?.message || null;
      if (!background) showToast('Could not refresh member details — showing saved details.', 'error');
      render();
      return false;
    };

    // If we have initial data, render immediately
    if (member) {
      render();
    } else {
      el.innerHTML = '<div style="padding:48px;text-align:center">Loading member details…</div>';
    }

    // Refresh from API to ensure address and latest data are up to date
    await refreshMember();

    // Listen for member updates from edit-member screen
    const onMemberUpdated = (e) => {
      if (e?.detail && String(e.detail.id) === String(memberId)) {
        member = e.detail;
        render();
      }
    };
    window.addEventListener('member-updated', onMemberUpdated);
    attachLiveRefresh(el, async () => { await refreshMember(true); }, 30000, () => window.removeEventListener('member-updated', onMemberUpdated));
  }
};
