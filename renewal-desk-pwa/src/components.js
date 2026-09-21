/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Shared UI Components
   Render functions for reusable UI elements
   ═══════════════════════════════════════════════════════════════════════ */

import { icon } from './icons.js';
import { router } from './router.js';
import { escapeHtml, getInitials, getAvatarColor, getMemberDisplayStatus, getMemberStatusColor, getPaymentStatusColor, formatCurrency, formatDate, getDaysText } from './utils.js';

// ─── Toast System ────────────────────────────────────────────────────

let toastTimer = null;

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  container.innerHTML = `<div class="toast ${type}">${icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info', 18, 'white')}<span>${escapeHtml(message)}</span></div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { container.innerHTML = ''; }, 3000);
}

// ─── Confirm Dialog ──────────────────────────────────────────────────

export function showConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', destructive = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay center';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-dialog-title">${escapeHtml(title)}</div>
        <div class="confirm-dialog-message">${escapeHtml(message)}</div>
        <div class="confirm-dialog-actions">
          <button class="btn ${destructive ? 'btn-danger' : 'btn-primary'} btn-full" id="confirm-yes">${escapeHtml(confirmText)}</button>
          <button class="btn btn-secondary btn-full" id="confirm-no">${escapeHtml(cancelText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirm-no').onclick = () => { overlay.remove(); resolve(false); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
  });
}

// ─── Header ──────────────────────────────────────────────────────────

export function renderHeader({ title, subtitle, showBack, onBack, actions = [] }) {
  const shouldShowBack = showBack !== undefined ? showBack : (router ? router.canGoBack() : false);
  const actionsHtml = actions.map((a, i) =>
    `<button class="header-action" id="header-action-${i}" aria-label="${escapeHtml(a.label || '')}">${a.badge ? '<span class="header-badge"></span>' : ''}${icon(a.icon, 22)}</button>`
  ).join('');

  return `
    <div class="app-header has-safe-top">
      <div class="header-left">
        ${shouldShowBack ? `<button class="header-back" id="header-back" aria-label="Go back" type="button">${icon('back', 22)}</button>` : ''}
        <div class="header-titles">
          <div class="header-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="header-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
      </div>
      <div class="header-right">${actionsHtml}</div>
    </div>`;
}

export function bindHeaderEvents(el, { onBack, actions = [] } = {}) {
  const backBtn = el.querySelector('#header-back');
  if (backBtn) {
    backBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onBack === 'function') {
        onBack();
      } else if (router) {
        router.back();
      }
    };
  }
  actions.forEach((a, i) => {
    el.querySelector(`#header-action-${i}`)?.addEventListener('click', a.onClick);
  });
}

// ─── Tab Bar ─────────────────────────────────────────────────────────

const tabs = [
  { id: 'dashboard', label: 'Home', icon: 'dashboard' },
  { id: 'members', label: 'Members', icon: 'members' },
  { id: 'renewals', label: 'Renewals', icon: 'renewals' },
  { id: 'payments', label: 'Payments', icon: 'payments' },
  { id: 'more', label: 'Options', icon: 'more' },
];

export function renderTabBar(activeTab) {
  return `
    <div class="tab-bar">
      ${tabs.map(t => `
        <button class="tab-item ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
          <span class="tab-icon">${icon(t.icon, 22)}</span>
          <span class="tab-label">${t.label}</span>
        </button>
      `).join('')}
    </div>`;
}

// ─── Avatar ──────────────────────────────────────────────────────────

export function renderAvatar(name, size = 'md') {
  const initials = getInitials(name);
  const color = getAvatarColor(name);
  return `<div class="avatar avatar-${size}" style="background:${color}">${escapeHtml(initials)}</div>`;
}

// ─── Status Badge ────────────────────────────────────────────────────

export function renderBadge(status) {
  const displayStatus = status.toLowerCase().replace(/\s+/g, '-');
  let badgeClass = 'badge-info';
  if (['active', 'paid', 'verified', 'connected'].includes(displayStatus)) badgeClass = 'badge-active';
  else if (['expiring', 'pending'].includes(displayStatus)) badgeClass = 'badge-pending';
  else if (['expired', 'failed', 'rejected'].includes(displayStatus)) badgeClass = 'badge-expired';
  else if (displayStatus === 'expiring') badgeClass = 'badge-expiring';
  return `<span class="badge ${badgeClass}">${escapeHtml(status)}</span>`;
}

// ─── Skeleton Loaders ────────────────────────────────────────────────

export function renderDashboardSkeleton() {
  return `
    <div style="padding: var(--sp-lg)">
      <div class="skeleton" style="height:24px;width:180px;margin-bottom:var(--sp-lg)"></div>
      <div class="metric-grid" style="margin-bottom:var(--sp-xl)">
        ${Array(4).fill('<div class="skeleton" style="height:100px;border-radius:var(--r-lg)"></div>').join('')}
      </div>
      <div class="skeleton" style="height:120px;border-radius:var(--r-lg);margin-bottom:var(--sp-lg)"></div>
      <div class="skeleton" style="height:18px;width:140px;margin-bottom:var(--sp-md)"></div>
      ${Array(3).fill('<div class="skeleton skeleton-card"></div>').join('')}
    </div>`;
}

export function renderListSkeleton(count = 5) {
  return Array(count).fill(`
    <div style="display:flex;gap:var(--sp-md);padding:var(--sp-md) var(--sp-lg);border-bottom:1px solid var(--border-light)">
      <div class="skeleton skeleton-circle" style="width:40px;height:40px"></div>
      <div style="flex:1">
        <div class="skeleton skeleton-text" style="width:60%"></div>
        <div class="skeleton skeleton-text short" style="width:40%"></div>
      </div>
    </div>
  `).join('');
}

// ─── Empty State ─────────────────────────────────────────────────────

export function renderEmptyState({ icon: iconName = 'search', title, text, actionText, actionId }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon(iconName, 28)}</div>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      ${text ? `<div class="empty-state-text">${escapeHtml(text)}</div>` : ''}
      ${actionText ? `<button class="btn btn-primary" id="${actionId || 'empty-action'}">${escapeHtml(actionText)}</button>` : ''}
    </div>`;
}

// ─── Error State ─────────────────────────────────────────────────────

export function renderErrorState(message, retryId = 'retry-btn') {
  return `
    <div class="empty-state">
      <div class="empty-state-icon" style="background:var(--critical-surface);color:var(--critical)">${icon('alert', 28)}</div>
      <div class="empty-state-title">Something went wrong</div>
      <div class="empty-state-text">${escapeHtml(message)}</div>
      <button class="btn btn-primary" id="${retryId}">${icon('refresh', 16, 'white')} Try Again</button>
    </div>`;
}

// ─── Member Card ─────────────────────────────────────────────────────

export function renderMemberCard(member) {
  const displayStatus = getMemberDisplayStatus(member);
  const daysText = getDaysText(member.days_until_expiry);
  return `
    <div class="list-item" data-member-id="${member.id}">
      ${renderAvatar(member.full_name)}
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(member.full_name)}</div>
        <div class="list-item-subtitle">${escapeHtml(member.phone)}${member.plan ? ` · ${escapeHtml(member.plan.name)}` : ''}</div>
      </div>
      <div class="list-item-right">
        ${renderBadge(displayStatus)}
        ${daysText ? `<span style="font-size:var(--fs-xs);color:var(--text-secondary)">${escapeHtml(daysText)}</span>` : ''}
      </div>
    </div>`;
}

// ─── Payment Card ────────────────────────────────────────────────────

export function renderPaymentCard(payment) {
  const statusColor = getPaymentStatusColor(payment.status);
  return `
    <div class="list-item" data-payment-id="${payment.id}">
      ${renderAvatar(payment.member_name || 'Unknown')}
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(payment.member_name || 'Unknown')}</div>
        <div class="list-item-subtitle">${escapeHtml(payment.method)} · ${formatDate(payment.paid_on || payment.created_at)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${formatCurrency(payment.amount)}</span>
        ${renderBadge(payment.status)}
      </div>
    </div>`;
}

// ─── Metric Card ─────────────────────────────────────────────────────

export function renderMetricCard({ label, value, iconName, color, bgColor, onClick }) {
  return `
    <div class="metric-card" ${onClick ? `data-action="${onClick}"` : ''} style="cursor:${onClick ? 'pointer' : 'default'}">
      <div class="metric-card-icon" style="background:${bgColor || 'var(--brand-subtle)'}">
        ${icon(iconName || 'stats', 20, color || 'var(--brand)')}
      </div>
      <div class="metric-card-value" style="color:${color || 'var(--text)'}">${value}</div>
      <div class="metric-card-label">${escapeHtml(label)}</div>
    </div>`;
}

// ─── Section Header ──────────────────────────────────────────────────

export function renderSectionHeader(title, actionText, actionId) {
  return `
    <div class="section-header">
      <div class="section-header-title">${escapeHtml(title)}</div>
      ${actionText ? `<button class="section-header-action" id="${actionId || ''}">${escapeHtml(actionText)}</button>` : ''}
    </div>`;
}

// ─── Menu Item ───────────────────────────────────────────────────────

export function renderMenuItem({ iconName, iconColor, iconBg, label, desc, onClick, badge }) {
  return `
    <div class="menu-item" ${onClick ? `data-action="${onClick}"` : ''}>
      <div class="menu-item-icon" style="background:${iconBg || 'var(--brand-subtle)'}">
        ${icon(iconName, 20, iconColor || 'var(--brand)')}
      </div>
      <div class="menu-item-content">
        <div class="menu-item-label">${escapeHtml(label)}</div>
        ${desc ? `<div class="menu-item-desc">${escapeHtml(desc)}</div>` : ''}
      </div>
      ${badge ? `<span class="badge badge-pending" style="font-size:10px">${badge}</span>` : ''}
      <span class="menu-item-chevron">${icon('chevronRight', 18)}</span>
    </div>`;
}

// ─── Form Field ──────────────────────────────────────────────────────

export function renderFormField({ id, label, type = 'text', value = '', placeholder = '', required = false, options, hint }) {
  let input;
  if (options) {
    input = `<select class="form-input" id="${id}" ${required ? 'required' : ''}>
      <option value="" disabled ${!value ? 'selected' : ''}>${placeholder || 'Select...'}</option>
      ${options.map(o => `<option value="${escapeHtml(String(o.value))}" ${String(o.value) === String(value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    input = `<textarea class="form-input" id="${id}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>${escapeHtml(value)}</textarea>`;
  } else {
    input = `<input class="form-input" id="${id}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} autocomplete="off">`;
  }

  return `
    <div class="form-group">
      ${label ? `<label class="form-label" for="${id}">${escapeHtml(label)}${required ? ' *' : ''}</label>` : ''}
      ${input}
      ${hint ? `<span class="form-hint">${escapeHtml(hint)}</span>` : ''}
    </div>`;
}

// ─── Info Row ────────────────────────────────────────────────────────

export function renderInfoRow(label, value) {
  return `
    <div class="info-row">
      <span class="info-row-label">${escapeHtml(label)}</span>
      <span class="info-row-value">${escapeHtml(String(value ?? '—'))}</span>
    </div>`;
}

// ─── iOS Install Prompt ──────────────────────────────────────────────

export function renderInstallPrompt() {
  return `
    <div class="install-prompt" id="install-prompt">
      <button class="header-action" style="position:absolute;top:var(--sp-lg);right:var(--sp-lg)" id="install-dismiss">${icon('close', 20)}</button>
      <div class="install-prompt-title">Install Renewal Desk</div>
      <div class="install-prompt-text">Add this app to your home screen for the best experience — works offline and feels like a native app.</div>
      <ul class="install-prompt-steps">
        <li class="install-prompt-step">
          <span class="install-prompt-step-number">1</span>
          Tap the <strong>Share</strong> button ${icon('share', 16, 'var(--brand)')} in Safari
        </li>
        <li class="install-prompt-step">
          <span class="install-prompt-step-number">2</span>
          Scroll down and tap <strong>"Add to Home Screen"</strong>
        </li>
        <li class="install-prompt-step">
          <span class="install-prompt-step-number">3</span>
          Tap <strong>"Add"</strong> to install
        </li>
      </ul>
      <button class="btn btn-primary btn-full" id="install-got-it">Got it</button>
    </div>`;
}
