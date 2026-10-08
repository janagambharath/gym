import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml, formatDateTime } from '../utils.js';
import { icon } from '../icons.js';
import { showToast } from '../components.js';

const OPEN = new Set(['new', 'contacted', 'interested', 'trial_requested', 'booked']);
const statusLabel = {
  new: 'New', contacted: 'Contacted', interested: 'Interested', trial_requested: 'Trial requested',
  booked: 'Trial booked', converted: 'Joined', lost: 'Lost', closed: 'Closed',
};

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading your lead pipeline…</div>';
  const result = await apiRequest('/api/mobile/v1/owner/leads');
  if (!result.ok) {
    el.innerHTML = `<main class="owner-ops-page"><div class="rrr-empty"><h2>Lead pipeline unavailable</h2><p>${escapeHtml(result.error?.message || 'Please try again.')}</p><button id="owner-retry">Retry</button></div></main>`;
    el.querySelector('#owner-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const leads = result.data?.leads || [];
  const active = leads.filter(lead => OPEN.has(lead.status));
  const booked = leads.filter(lead => lead.status === 'booked');
  const newLeads = leads.filter(lead => lead.status === 'new');

  el.innerHTML = `<main class="rrr-page owner-ops-page">
    <header class="rrr-workspace-bar"><button class="owner-back" id="owner-back">${icon('back', 18)} Dashboard</button><div class="rrr-header-actions"><button class="rrr-add-button" id="lead-add">${icon('add', 18, 'white')} Add lead</button></div></header>
    <section class="owner-page-hero"><div><span class="rrr-eyebrow">FRONT DESK PIPELINE</span><h1>Leads & trial visits</h1><p>Every enquiry has an owner, a next step, and a visible outcome.</p></div><div class="owner-pipeline-summary"><span><b>${newLeads.length}</b>New</span><span><b>${active.length}</b>Open</span><span><b>${booked.length}</b>Trials booked</span></div></section>
    <section class="owner-lead-form is-hidden" id="lead-form-wrap">
      <div class="rrr-panel-head"><div><h2>Add a lead</h2><p>Capture walk-ins and phone enquiries even without WhatsApp automation.</p></div><button class="owner-text-button" id="lead-cancel">Cancel</button></div>
      <form id="lead-form" class="owner-form-grid">
        <label>Full name<input name="name" required maxlength="160" placeholder="e.g. Neha Rao"></label>
        <label>Phone number<input name="phone" required maxlength="40" placeholder="+91 98…"></label>
        <label>Source<select name="source"><option value="walk_in">Walk-in</option><option value="phone">Phone</option><option value="referral">Referral</option><option value="instagram">Instagram</option><option value="google">Google</option><option value="whatsapp">WhatsApp</option><option value="other">Other</option></select></label>
        <label>Next follow-up<input name="next_follow_up_at" type="datetime-local"></label>
        <label>Interested in<input name="interested_plan" maxlength="160" placeholder="Membership / personal training"></label>
        <label class="owner-form-wide">Notes<textarea name="notes" maxlength="4000" rows="3" placeholder="Goal, budget, schedule or anything the team should know"></textarea></label>
        <label class="owner-check"><input name="trial_requested" type="checkbox"> Wants a trial visit</label>
        <button class="rrr-add-button" type="submit">Save lead</button>
      </form>
    </section>
    <section class="owner-lead-toolbar"><div class="owner-segmented" id="lead-filter"><button data-filter="open" class="is-active">Open (${active.length})</button><button data-filter="booked">Trials (${booked.length})</button><button data-filter="all">All (${leads.length})</button></div><span>Follow up before the lead goes cold.</span></section>
    <section class="owner-lead-list" id="lead-list"></section>
  </main>`;

  let filter = 'open';
  const list = el.querySelector('#lead-list');
  function renderList() {
    const visible = filter === 'open' ? leads.filter(lead => OPEN.has(lead.status)) : filter === 'booked' ? booked : leads;
    list.innerHTML = visible.length ? visible.map(leadCard).join('') : `<div class="rrr-empty"><h2>No ${filter === 'all' ? '' : filter} leads</h2><p>Add a lead or switch the filter to see your pipeline.</p></div>`;
    bindLeadActions(el, leads);
  }
  renderList();
  el.querySelector('#owner-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelector('#lead-add')?.addEventListener('click', () => el.querySelector('#lead-form-wrap')?.classList.remove('is-hidden'));
  el.querySelector('#lead-cancel')?.addEventListener('click', () => el.querySelector('#lead-form-wrap')?.classList.add('is-hidden'));
  el.querySelector('#lead-filter')?.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    el.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item === button));
    renderList();
  });
  el.querySelector('#lead-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiRequest('/api/mobile/v1/owner/leads', { method: 'POST', body: {
      name: form.get('name'), phone: form.get('phone'), source: form.get('source'),
      interested_plan: form.get('interested_plan'), notes: form.get('notes'),
      trial_requested: form.get('trial_requested') === 'on',
      next_follow_up_at: localInputToIso(form.get('next_follow_up_at')),
    }});
    if (response.ok) { showToast('Lead saved to the follow-up queue.', 'success'); await load(el); }
    else showToast(response.error?.message || 'Could not save this lead.', 'error');
  });
}

function leadCard(lead) {
  const due = lead.next_follow_up_at ? formatDateTime(lead.next_follow_up_at) : 'Set a follow-up time';
  const trial = lead.trial_scheduled_for ? `Trial: ${formatDateTime(lead.trial_scheduled_for)}` : '';
  return `<article class="owner-lead-card"><div class="owner-lead-avatar">${escapeHtml((lead.name || '?').slice(0, 1).toUpperCase())}</div><div class="owner-lead-main"><div class="owner-lead-title"><h2>${escapeHtml(lead.name || 'Unnamed lead')}</h2><span class="owner-status owner-status-${escapeHtml(lead.status)}">${escapeHtml(statusLabel[lead.status] || lead.status)}</span></div><p>${escapeHtml(lead.phone || '')}${lead.source ? ` · ${escapeHtml(lead.source.replace('_', ' '))}` : ''}</p><div class="owner-lead-meta"><span>${icon('time', 14)} ${escapeHtml(due)}</span>${trial ? `<span>${icon('calendar', 14)} ${escapeHtml(trial)}</span>` : ''}${lead.interested_plan ? `<span>${icon('fitness', 14)} ${escapeHtml(lead.interested_plan)}</span>` : ''}</div>${lead.notes ? `<p class="owner-lead-note">${escapeHtml(lead.notes)}</p>` : ''}</div><div class="owner-lead-actions">${lead.status === 'new' ? `<button data-lead-action="contacted" data-lead-id="${lead.id}">Mark contacted</button>` : ''}${lead.status !== 'booked' && OPEN.has(lead.status) ? `<button class="primary" data-lead-action="book" data-lead-id="${lead.id}">Book trial</button>` : ''}${lead.status === 'booked' ? `<button class="primary" data-lead-action="attended" data-lead-id="${lead.id}">Trial attended</button>` : ''}${OPEN.has(lead.status) ? `<button data-lead-action="followup" data-lead-id="${lead.id}">Set follow-up</button><button class="danger" data-lead-action="lost" data-lead-id="${lead.id}">Mark lost</button>` : ''}</div></article>`;
}

function bindLeadActions(el, leads) {
  el.querySelectorAll('[data-lead-action]').forEach(button => button.addEventListener('click', async () => {
    const lead = leads.find(item => String(item.id) === button.dataset.leadId);
    if (!lead) return;
    const action = button.dataset.leadAction;
    let body;
    if (action === 'contacted') body = { status: 'contacted' };
    if (action === 'attended') body = { status: 'interested', mark_trial_attended: true };
    if (action === 'book' || action === 'followup') {
      const value = prompt(action === 'book' ? 'Trial date and time (for example 2026-10-09T18:30):' : 'Next follow-up (for example 2026-10-09T18:30):', action === 'book' ? toLocalInput(new Date(Date.now() + 86400000)) : toLocalInput(new Date(Date.now() + 86400000)));
      if (value === null) return;
      const parsed = localInputToIso(value);
      if (!parsed) { showToast('Enter a valid date and time.', 'error'); return; }
      body = action === 'book' ? { status: 'booked', trial_requested: true, trial_scheduled_for: parsed } : { next_follow_up_at: parsed };
    }
    if (action === 'lost') {
      const reason = prompt('Why was this lead lost? (optional)', '') ;
      if (reason === null) return;
      body = { status: 'lost', lost_reason: reason };
    }
    if (!body) return;
    button.disabled = true;
    const response = await apiRequest(`/api/mobile/v1/owner/leads/${lead.id}`, { method: 'PATCH', body });
    if (response.ok) { showToast('Lead updated.', 'success'); await load(el); }
    else { button.disabled = false; showToast(response.error?.message || 'Could not update this lead.', 'error'); }
  }));
}

function localInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toLocalInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
