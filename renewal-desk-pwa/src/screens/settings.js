/* Settings / More Screen */
import { attachLiveRefresh } from '../live-refresh.js';
import { apiRequest, getCachedSession, logout as apiLogout } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { router } from '../router.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderMenuItem, renderBadge, renderInfoRow, showConfirm, showToast } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    const session = getCachedSession();
    const settingsRes = await apiRequest('/api/mobile/v1/settings');
    const showLinkBanner = settingsRes.ok
      ? settingsRes.data.gym?.show_biometric_link_banner !== false
      : true;
    el.innerHTML = `
      ${renderHeader({ title: 'More', showBack: router.depth > 0 })}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${renderAvatar(session?.userName || 'User', 'lg')}
            <div style="flex:1;min-width:0">
              <div id="settings-user-name" style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${escapeHtml(session?.userName || '')}</div>
              <div id="settings-tenant-name" style="font-size:var(--fs-sm);color:var(--text-secondary)">${escapeHtml(session?.tenantName || '')}</div>
              <div id="settings-role-badge" style="margin-top:var(--sp-xs)">${renderBadge(session?.userRole || 'owner')}</div>
            </div>
          </div>
        </div>

        <!-- Gym Management -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Gym Management</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${renderMenuItem({ iconName: 'business', label: 'Gym Profile', desc: 'Name, contact, address', iconBg: 'var(--brand-subtle)', iconColor: 'var(--brand)', onClick: 'gym-profile' })}
          ${renderMenuItem({ iconName: 'plan', label: 'Membership Plans', desc: 'Manage pricing & durations', iconBg: 'var(--brand-subtle)', iconColor: 'var(--brand)', onClick: 'plans' })}
          ${renderMenuItem({ iconName: 'calendar', label: 'Date Repair', desc: 'Fix member dates that don\'t match payments', iconBg: 'var(--warning-surface)', iconColor: 'var(--warning)', onClick: 'date-repair' })}
          ${renderMenuItem({ iconName: 'staff', label: 'Staff', desc: 'Manage team members', iconBg: 'var(--info-surface)', iconColor: 'var(--info)', onClick: 'staff' })}
          ${renderMenuItem({ iconName: 'report', label: 'Reports', desc: 'Analytics & summaries', iconBg: 'var(--success-surface)', iconColor: 'var(--success)', onClick: 'reports' })}
          ${renderMenuItem({ iconName: 'wallet', label: 'Payment Setup', desc: 'UPI & QR settings', iconBg: 'var(--status-pending-surface)', iconColor: 'var(--status-pending)', onClick: 'payment-setup' })}
          ${renderMenuItem({ iconName: 'access', label: 'Access Control', desc: 'Biometric & attendance', iconBg: '#fce7f3', iconColor: '#db2777', onClick: 'access' })}
        </div>

        ${session?.userRole === 'gym_owner' ? `
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Dashboard Preferences</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          <label for="show-biometric-link-banner" style="display:flex;align-items:center;gap:var(--sp-md);padding:var(--sp-lg);cursor:pointer">
            <span style="flex:1;min-width:0"><b style="display:block;color:var(--text);font-size:var(--fs-md)">Biometric ID linking reminder</b><small style="display:block;color:var(--text-secondary);margin-top:4px;line-height:1.45">Show a reminder when terminal IDs need a member match.</small></span>
            <input id="show-biometric-link-banner" type="checkbox" ${showLinkBanner ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--brand);flex:0 0 auto">
          </label>
          <p id="biometric-link-banner-status" role="status" style="margin:0;padding:0 var(--sp-lg) var(--sp-md);font-size:var(--fs-xs);color:var(--muted)"></p>
        </div>` : ''}

        <!-- Communication -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Communication</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${renderMenuItem({ iconName: 'whatsapp', label: 'WhatsApp', desc: 'Reminders & broadcasts', iconBg: '#dcfce7', iconColor: 'var(--whatsapp)', onClick: 'whatsapp' })}
          ${renderMenuItem({ iconName: 'robot', label: 'AI Receptionist', desc: 'WhatsApp bot settings', iconBg: '#ede9fe', iconColor: '#7c3aed', onClick: 'bot-overview' })}
          ${renderMenuItem({ iconName: 'megaphone', label: 'Campaigns', desc: 'Bulk messaging', iconBg: 'var(--warning-surface)', iconColor: 'var(--warning)', onClick: 'campaigns' })}
          ${renderMenuItem({ iconName: 'inbox', label: 'Inbox', desc: 'Messages & conversations', iconBg: 'var(--info-surface)', iconColor: 'var(--info)', onClick: 'inbox' })}
          ${renderMenuItem({ iconName: 'notifications', label: 'Notifications', desc: 'Activity feed', iconBg: 'var(--critical-surface)', iconColor: 'var(--critical)', onClick: 'notifications' })}
        </div>

        <!-- Account -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Account</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${renderMenuItem({ iconName: 'subscription', label: 'Subscription', desc: 'Billing & plan', iconBg: 'var(--brand-subtle)', iconColor: 'var(--brand)', onClick: 'subscription' })}
        </div>

        <!-- Actions -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
          <button class="btn btn-secondary btn-full" id="btn-logout">${icon('logout', 18)} Sign Out</button>
          <button class="btn btn-danger btn-full btn-sm" id="btn-delete" style="margin-top:var(--sp-md)">Delete Account & Data</button>
        </div>
      </div></div>`;

    bindHeaderEvents(el, {
      onBack: () => router.depth > 1 ? navigate.pop() : navigate.switchTab('home'),
    });

    // Menu item clicks
    el.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        navigate.push(item.dataset.action);
      });
    });

    const linkBannerToggle = el.querySelector('#show-biometric-link-banner');
    linkBannerToggle?.addEventListener('change', async () => {
      const previous = !linkBannerToggle.checked;
      linkBannerToggle.disabled = true;
      const result = await apiRequest('/api/mobile/v1/settings', {
        method: 'PATCH',
        body: { show_biometric_link_banner: linkBannerToggle.checked },
      });
      linkBannerToggle.disabled = false;
      const status = el.querySelector('#biometric-link-banner-status');
      if (result.ok) {
        status.textContent = linkBannerToggle.checked ? 'Reminder is on.' : 'Reminder is off on this gym’s dashboards.';
      } else {
        linkBannerToggle.checked = previous;
        status.textContent = result.error?.message || 'Could not save this preference.';
      }
    });

    el.querySelector('#btn-logout').addEventListener('click', async () => {
      const yes = await showConfirm({ title: 'Sign Out', message: 'Are you sure you want to sign out?', confirmText: 'Sign Out' });
      if (yes) handleLogout();
    });

    el.querySelector('#btn-delete').addEventListener('click', async () => {
      const yes = await showConfirm({ title: 'Delete Account', message: 'This will permanently delete your account and all gym data. This cannot be undone.', confirmText: 'Delete Permanently', destructive: true });
      if (!yes) return;
      const { deleteAccount } = await import('../api.js');
      const result = await deleteAccount();
      if (result.ok) handleLogout();
      else showToast(result.error?.message || 'Could not delete the account. You are still signed in.', 'error');
    });

    // H16 remainder: refresh the profile card when returning from Gym
    // Profile / Plans so Settings never shows a stale name/role.
    attachLiveRefresh(el, async () => {
      const fresh = await apiRequest('/api/mobile/v1/settings');
      if (!fresh.ok || el.dataset.screenDisposed === 'true') return;
      const gymName = fresh.data.gym?.name || fresh.data.settings?.name || fresh.data.name;
      if (gymName) {
        const nameEl = el.querySelector('#settings-tenant-name');
        if (nameEl) nameEl.textContent = gymName;
      }
      const sess = getCachedSession();
      const userEl = el.querySelector('#settings-user-name');
      if (sess?.userName && userEl) userEl.textContent = sess.userName;
      const roleEl = el.querySelector('#settings-role-badge');
      if (sess?.userRole && roleEl) roleEl.innerHTML = renderBadge(sess.userRole);
    }, 30000);
  }
};
