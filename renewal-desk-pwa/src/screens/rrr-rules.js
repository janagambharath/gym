import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

const fields = [
  ['expiry_days', 'Membership expiry window (days)'],
  ['no_visit_days', 'No-visit risk threshold (days)'],
  ['attendance_drop_percent', 'Attendance decline threshold (%)'],
  ['recent_expiry_days', 'Recent-expiry recovery window (days)'],
];

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading gym signal rules…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/rules');
  if (!result.ok) { el.innerHTML = '<main class="rrr-page rrr-detail"><h1>Rules unavailable</h1><button id="rrr-retry">Retry</button></main>'; el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el)); return; }
  const rules = result.data.rules || {};
  el.innerHTML = `<main class="rrr-page rrr-detail"><header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Signal rules</span></div></header><h1>Gym thresholds</h1><p>These thresholds control explainable opportunity detection. No automated messages are sent from this screen.</p><form id="rrr-rule-form" class="rrr-panel">${fields.map(([key, label]) => `<label class="form-label" for="rule-${key}">${label}<input class="form-input" id="rule-${key}" type="number" min="1" max="365" required value="${escapeHtml(rules[key] ?? result.data.defaults[key])}"></label>`).join('')}<button type="submit">Save thresholds</button><span id="rrr-rule-message" role="status"></span></form></main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.push('rrr-integrations'));
  el.querySelector('#rrr-rule-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(fields.map(([key]) => [key, Number(el.querySelector(`#rule-${key}`).value)]));
    const saved = await apiRequest('/api/mobile/v1/rrr/rules', { method: 'PUT', body: { rules: values } });
    el.querySelector('#rrr-rule-message').textContent = saved.ok ? 'Thresholds saved.' : (saved.error?.message || 'Could not save thresholds.');
  });
}
