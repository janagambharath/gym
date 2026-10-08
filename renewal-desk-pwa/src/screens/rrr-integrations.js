import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading integration status…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/integrations');
  const integration = result.ok ? (result.data.integrations || []).find(x => x.type === 'ebioserver') : null;
  el.innerHTML = `<main class="rrr-page rrr-detail"><header class="rrr-header"><button id="rrr-back">←</button><div class="rrr-brand"><b>RRR</b><span>Integrations</span></div></header><h1>eSSL eBioServer</h1><p>Your phone manages the connection through RRR. eBioServer credentials stay on the gym PC.</p><section class="rrr-panel"><h2>${escapeHtml(integration?.status || 'Not configured')}</h2><p>${integration?.device_serial ? `Device: ${escapeHtml(integration.device_serial)}` : 'Pair the eBioServer Bridge from the licensed gym PC.'}</p><p>Commissioning: ${escapeHtml(integration?.commissioning_status || 'not started')} · ${integration?.records_synced || 0} records synced · ${integration?.unmapped_records || 0} unmapped</p><button id="rrr-pair">Generate pairing code</button><div id="rrr-pair-code"></div>${integration?.commissioning_status === 'attendance_verified' && !integration?.commands_enabled ? '<button id="rrr-commission">Enable after supervised door test</button>' : ''}</section></main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelector('#rrr-pair')?.addEventListener('click', async () => {
    const pair = await apiRequest('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    const box = el.querySelector('#rrr-pair-code');
    box.textContent = pair.ok ? `Pairing code: ${pair.data.pairing_code} (expires ${new Date(pair.data.expires_at).toLocaleTimeString()})` : 'Could not create pairing code.';
  });
  el.querySelector('#rrr-commission')?.addEventListener('click', async () => {
    if (!confirm('Confirm that a supervised physical door test passed.')) return;
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/commission`, { method: 'POST', body: { physical_test_passed: true } });
    if (response.ok) load(el);
  });
}
