/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Staff & Team Command Center
   Full mobile management: Add staff, roles, password reset, WhatsApp invite
   ═══════════════════════════════════════════════════════════════════════ */
import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import {
  renderHeader,
  bindHeaderEvents,
  renderAvatar,
  renderBadge,
  renderEmptyState,
  renderListSkeleton,
  renderFormField,
  showToast,
  showConfirm,
} from '../components.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../utils.js';

export default {
  async mount(el) {
    let staffMembers = [];
    let showAddModal = false;
    let selectedStaff = null;
    let createdInvite = null;

    async function loadData() {
      const res = await apiRequest('/api/mobile/v1/staff');
      staffMembers = res.ok ? res.data.staff || [] : [];
      render();
    }

    function render() {
      el.innerHTML = `
        ${renderHeader({
          title: 'Staff Management',
          showBack: true,
          actions: [{ icon: 'add', label: 'Add Staff' }],
        })}

        <div class="scroll-view">
          <div class="scroll-content" style="padding-bottom:calc(var(--tab-bar-height) + 24px)">
            ${
              staffMembers.length === 0
                ? renderEmptyState({
                    icon: 'staff',
                    title: 'No staff members yet',
                    text: 'Add trainers, managers, or receptionists to your team.',
                    actionText: '+ Add First Staff',
                    actionId: 'btn-empty-add-staff',
                  })
                : `
              <div style="padding:var(--sp-md) var(--sp-lg) var(--sp-xs)">
                <span style="font-size:var(--fs-xs);font-weight:var(--fw-bold);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
                  Team Members (${staffMembers.length})
                </span>
              </div>
              <div class="card" style="margin:0 var(--sp-lg)">
                ${staffMembers
                  .map(
                    (s) => `
                  <div class="list-item" data-staff-id="${s.id}" style="cursor:pointer;padding:var(--sp-md)">
                    <div style="display:flex;align-items:center;gap:var(--sp-md);flex:1">
                      ${renderAvatar(s.full_name, 44)}
                      <div class="list-item-content">
                        <div class="list-item-title" style="font-weight:var(--fw-semibold)">${escapeHtml(s.full_name)}</div>
                        <div class="list-item-subtitle" style="display:flex;gap:var(--sp-sm);align-items:center">
                          <span>${escapeHtml(s.email)}</span>
                        </div>
                      </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-xs)">
                      ${renderBadge(s.role === 'gym_owner' ? 'Owner' : 'Staff', s.role === 'gym_owner' ? 'primary' : 'neutral')}
                      ${!s.is_active ? renderBadge('Inactive', 'critical') : ''}
                    </div>
                    <div style="color:var(--text-muted);margin-left:var(--sp-sm)">${icon('forward', 16)}</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            }
          </div>
        </div>

        ${
          showAddModal
            ? `
          <div class="modal-backdrop" id="add-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:flex-end;justify-content:center">
            <div class="card" style="width:100%;max-width:500px;border-radius:var(--r-2xl) var(--r-2xl) 0 0;padding:var(--sp-xl);max-height:85vh;overflow-y:auto;background:var(--surface)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-lg)">
                <h3 style="margin:0;font-size:var(--fs-lg)">+ Add Staff Member</h3>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-close-add" style="border:none;background:transparent">${icon('close', 20)}</button>
              </div>
              <form id="add-staff-form" style="display:flex;flex-direction:column;gap:var(--sp-md)">
                ${renderFormField({ id: 'st-name', label: 'Full Name', placeholder: 'e.g. Vikram Singh', required: true })}
                ${renderFormField({ id: 'st-phone', label: 'Mobile Number', placeholder: '+91 98765 43210', type: 'tel' })}
                ${renderFormField({ id: 'st-email', label: 'Email Address', placeholder: 'vikram@example.com', type: 'email', required: true })}
                <div class="form-group">
                  <label class="form-label" style="display:block;margin-bottom:var(--sp-xs);font-size:var(--fs-sm);font-weight:var(--fw-medium)">Role</label>
                  <select id="st-role" class="form-control" style="width:100%;padding:var(--sp-md);border-radius:var(--r-md);border:1px solid var(--border);background:var(--surface)">
                    <option value="staff" selected>Staff (Desk / Trainer)</option>
                    <option value="gym_owner">Gym Co-Owner / Manager</option>
                  </select>
                </div>
                ${renderFormField({ id: 'st-pass', label: 'Temporary Password (Optional)', placeholder: 'Leave empty to auto-generate', type: 'password' })}
                <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-md)">
                  <button type="submit" class="btn btn-primary" style="flex:1" id="btn-save-staff">Create & Invite</button>
                  <button type="button" class="btn btn-secondary" id="btn-cancel-add">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        `
            : ''
        }

        ${
          createdInvite
            ? `
          <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:var(--sp-lg)">
            <div class="card" style="width:100%;max-width:440px;padding:var(--sp-xl);text-align:center;background:var(--surface)">
              <div style="font-size:40px;margin-bottom:var(--sp-sm)">🎉</div>
              <h3 style="margin-bottom:var(--sp-xs)">Staff Account Created!</h3>
              <p style="color:var(--text-muted);font-size:var(--fs-sm);margin-bottom:var(--sp-lg)">
                ${escapeHtml(createdInvite.full_name)} can now log into Renewal Desk.
              </p>
              <div style="background:var(--surface-subtle);border-radius:var(--r-md);padding:var(--sp-md);margin-bottom:var(--sp-lg);text-align:left;font-family:monospace">
                <div><strong>Email:</strong> ${escapeHtml(createdInvite.email)}</div>
                <div><strong>Password:</strong> ${escapeHtml(createdInvite.temp_password || '********')}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:var(--sp-sm)">
                ${
                  createdInvite.invite_whatsapp_url
                    ? `
                  <a href="${createdInvite.invite_whatsapp_url}" target="_blank" class="btn btn-primary" style="background:#25D366;border-color:#25D366;display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                    ${icon('whatsapp', 18)} Share via WhatsApp
                  </a>
                `
                    : ''
                }
                <button type="button" class="btn btn-secondary" id="btn-dismiss-invite">Done</button>
              </div>
            </div>
          </div>
        `
            : ''
        }

        ${
          selectedStaff
            ? `
          <div class="modal-backdrop" id="action-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:flex-end;justify-content:center">
            <div class="card" style="width:100%;max-width:500px;border-radius:var(--r-2xl) var(--r-2xl) 0 0;padding:var(--sp-xl);background:var(--surface)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-lg)">
                <div style="display:flex;align-items:center;gap:var(--sp-md)">
                  ${renderAvatar(selectedStaff.full_name, 48)}
                  <div>
                    <h3 style="margin:0">${escapeHtml(selectedStaff.full_name)}</h3>
                    <div style="color:var(--text-muted);font-size:var(--fs-sm)">${escapeHtml(selectedStaff.email)} · ${selectedStaff.role}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary" id="btn-close-action" style="border:none;background:transparent">${icon('close', 20)}</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:var(--sp-sm)">
                <button type="button" class="btn btn-secondary" id="btn-reset-staff-pass" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                  ${icon('lock', 16)} Reset Password
                </button>
                <button type="button" class="btn btn-secondary" id="btn-toggle-staff-active" style="display:flex;align-items:center;justify-content:center;gap:var(--sp-sm)">
                  ${selectedStaff.is_active ? 'Deactivate Account' : 'Activate Account'}
                </button>
                <button type="button" class="btn btn-secondary" id="btn-cancel-action" style="margin-top:var(--sp-sm)">Cancel</button>
              </div>
            </div>
          </div>
        `
            : ''
        }
      `;

      bindHeaderEvents(el, {
        onBack: () => navigate.pop(),
        actions: [
          {
            onClick: () => {
              showAddModal = true;
              render();
            },
          },
        ],
      });

      el.querySelector('#btn-empty-add-staff')?.addEventListener('click', () => {
        showAddModal = true;
        render();
      });

      el.querySelectorAll('[data-staff-id]').forEach((item) => {
        item.addEventListener('click', () => {
          const id = Number(item.dataset.staffId);
          selectedStaff = staffMembers.find((s) => s.id === id) || null;
          render();
        });
      });

      // Add modal events
      el.querySelector('#btn-close-add')?.addEventListener('click', () => {
        showAddModal = false;
        render();
      });
      el.querySelector('#btn-cancel-add')?.addEventListener('click', () => {
        showAddModal = false;
        render();
      });

      el.querySelector('#add-staff-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = el.querySelector('#btn-save-staff');
        if (saveBtn) saveBtn.disabled = true;

        const body = {
          full_name: el.querySelector('#st-name')?.value.trim(),
          phone: el.querySelector('#st-phone')?.value.trim(),
          email: el.querySelector('#st-email')?.value.trim(),
          role: el.querySelector('#st-role')?.value,
          password: el.querySelector('#st-pass')?.value.trim() || undefined,
        };

        const res = await apiRequest('/api/mobile/v1/staff', { method: 'POST', body });
        if (res.ok) {
          showAddModal = false;
          createdInvite = res.data;
          showToast(`Staff account created for ${body.full_name}`, 'success');
          await loadData();
        } else {
          showToast(res.error?.message || 'Could not create staff account', 'error');
          if (saveBtn) saveBtn.disabled = false;
        }
      });

      // Invite dismiss
      el.querySelector('#btn-dismiss-invite')?.addEventListener('click', () => {
        createdInvite = null;
        render();
      });

      // Action modal events
      el.querySelector('#btn-close-action')?.addEventListener('click', () => {
        selectedStaff = null;
        render();
      });
      el.querySelector('#btn-cancel-action')?.addEventListener('click', () => {
        selectedStaff = null;
        render();
      });

      el.querySelector('#btn-toggle-staff-active')?.addEventListener('click', async () => {
        if (!selectedStaff) return;
        const willBeActive = !selectedStaff.is_active;
        const confirmMsg = willBeActive
          ? `Reactivate account for ${selectedStaff.full_name}?`
          : `Deactivate ${selectedStaff.full_name}? They will not be able to log in.`;
        const confirmed = await showConfirm({
          title: willBeActive ? 'Activate Staff' : 'Deactivate Staff',
          message: confirmMsg,
          confirmText: willBeActive ? 'Activate' : 'Deactivate',
          destructive: !willBeActive,
        });

        if (confirmed) {
          const res = await apiRequest(`/api/mobile/v1/staff/${selectedStaff.id}`, {
            method: 'PATCH',
            body: { is_active: willBeActive },
          });
          if (res.ok) {
            showToast(res.data?.message || 'Updated successfully', 'success');
            selectedStaff = null;
            await loadData();
          } else {
            showToast(res.error?.message || 'Failed to update', 'error');
          }
        }
      });

      el.querySelector('#btn-reset-staff-pass')?.addEventListener('click', async () => {
        if (!selectedStaff) return;
        const confirmed = await showConfirm({
          title: 'Reset Password',
          message: `Generate a new password for ${selectedStaff.full_name}?`,
          confirmText: 'Reset Password',
        });
        if (confirmed) {
          const res = await apiRequest(`/api/mobile/v1/staff/${selectedStaff.id}/reset-password`, {
            method: 'POST',
          });
          if (res.ok) {
            createdInvite = {
              full_name: selectedStaff.full_name,
              email: selectedStaff.email,
              temp_password: res.data.new_password,
              invite_whatsapp_url: res.data.invite_whatsapp_url,
            };
            selectedStaff = null;
            render();
          } else {
            showToast(res.error?.message || 'Failed to reset password', 'error');
          }
        }
      });
    }

    await loadData();
  },
};
