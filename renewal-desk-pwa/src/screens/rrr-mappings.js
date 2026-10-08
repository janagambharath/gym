import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading unresolved biometric punches…</div>';
  const [unresolved, members] = await Promise.all([
    apiRequest('/api/mobile/v1/rrr/mappings/unresolved'),
    apiRequest('/api/mobile/v1/members?page=1&page_size=100'),
  ]);
  if (!unresolved.ok || !members.ok) {
    el.innerHTML = '<main class="rrr-page rrr-detail"><h1>Mapping review unavailable</h1><p>Retry after reconnecting to RRR.</p><button id="rrr-retry">Retry</button></main>';
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  const events = unresolved.data.events || [];
  const people = members.data.members || [];
  el.innerHTML = `<main class="rrr-page rrr-detail"><header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Biometric mapping review</span></div></header><h1>Unmapped punches</h1><p>Mapping an external biometric ID to the correct member replays all retained punches for that ID.</p><section class="rrr-panel">${events.length ? events.map(event => `<article class="rrr-opportunity"><div><h2>Biometric ID ${escapeHtml(event.biometric_user_id)}</h2><p>${escapeHtml(event.source)} · ${escapeHtml(event.device_serial || 'device unknown')} · ${new Date(event.punch_time).toLocaleString()}</p></div><div><select data-map="${event.id}"><option value="">Choose member…</option>${people.map(person => `<option value="${person.id}">${escapeHtml(person.full_name)} · ${escapeHtml(person.phone)}</option>`).join('')}</select><button data-resolve="${encodeURIComponent(event.biometric_user_id)}">Map ID & replay</button></div></article>`).join('') : '<p class="rrr-no-data">No unresolved biometric punches. New unknown IDs will appear here automatically.</p>'}</section></main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.push('rrr-integrations'));
  el.querySelectorAll('[data-resolve]').forEach(button => button.addEventListener('click', async () => {
    const select = button.closest('.rrr-opportunity').querySelector('select');
    if (!select.value) { alert('Choose the matching member first.'); return; }
    const response = await apiRequest(`/api/mobile/v1/rrr/mappings/${button.dataset.resolve}`, { method: 'POST', body: { member_id: Number(select.value) } });
    if (response.ok) await load(el); else alert(response.error?.message || 'Mapping failed.');
  }));
}
