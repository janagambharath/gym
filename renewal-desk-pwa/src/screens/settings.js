/* Settings / More Screen */
import { apiRequest, getCachedSession, logout as apiLogout } from '../api.js';
import { navigate, handleLogout } from '../app.js';
import { router } from '../router.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderMenuItem, renderBadge, renderInfoRow, showConfirm, showToast } from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    const session = getCachedSession();
    el.innerHTML = `
      ${renderHeader({ title: 'Settings', showBack: true })}
      <div class="scroll-view"><div class="scroll-content">
        <!-- Profile Card -->
        <div class="card" style="margin:var(--sp-lg)">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--sp-lg)">
            ${renderAvatar(session?.userName || 'User', 'lg')}
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${escapeHtml(session?.userName || '')}</div>
              <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${escapeHtml(session?.tenantName || '')}</div>
              <div style="margin-top:var(--sp-xs)">${renderBadge(session?.userRole || 'owner')}</div>
            </div>
          </div>
        </div>

        <!-- Gym Management -->
        <div style="padding:var(--sp-xs) var(--sp-lg);font-size:var(--fs-xs);font-weight:var(--fw-semibold);color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Gym Management</div>
        <div class="card" style="margin:var(--sp-sm) var(--sp-lg) var(--sp-lg)">
          ${renderMenuItem({ iconName: 'plan', label: 'Membership Plans', desc: 'Manage pricing & durations', iconBg: 'var(--brand-subtle)', iconColor: 'var(--brand)', onClick: 'plans' })}
          ${renderMenuItem({ iconName: 'staff', label: 'Staff', desc: 'Manage team members', iconBg: 'var(--info-surface)', iconColor: 'var(--info)', onClick: 'staff' })}
          ${renderMenuItem({ iconName: 'report', label: 'Reports', desc: 'Analytics & summaries', iconBg: 'var(--success-surface)', iconColor: 'var(--success)', onClick: 'reports' })}
          ${renderMenuItem({ iconName: 'wallet', label: 'Payment Setup', desc: 'UPI & QR settings', iconBg: 'var(--status-pending-surface)', iconColor: 'var(--status-pending)', onClick: 'payment-setup' })}
          ${renderMenuItem({ iconName: 'access', label: 'Access Control', desc: 'Biometric & attendance', iconBg: '#fce7f3', iconColor: '#db2777', onClick: 'access' })}
        </div>

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
      onBack: () => router.depth > 1 ? navigate.pop() : navigate.switchTab('dashboard'),
    });

    // Menu item clicks
    el.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', () => navigate.push(item.dataset.action));
    });

    el.querySelector('#btn-logout').addEventListener('click', async () => {
      const yes = await showConfirm({ title: 'Sign Out', message: 'Are you sure you want to sign out?', confirmText: 'Sign Out' });
      if (yes) handleLogout();
    });

    el.querySelector('#btn-delete').addEventListener('click', async () => {
      const yes = await showConfirm({ title: 'Delete Account', message: 'This will permanently delete your account and all gym data. This cannot be undone.', confirmText: 'Delete Permanently', destructive: true });
      if (!yes) return;
      const { deleteAccount } = await import('../api.js');
      await deleteAccount();
      handleLogout();
    });
  }
};
