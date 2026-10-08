import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Loading integration status…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/integrations');
  const integration = result.ok ? (result.data.integrations || []).find(x => x.type === 'ebioserver') : null;
  const devices = result.ok ? result.data.devices || [] : [];
  el.innerHTML = `<main class="rrr-page rrr-detail"><header class="rrr-header"><button id="rrr-back">←</button><div class="rrr-brand"><b>RRR</b><span>Integrations</span></div></header><h1>eSSL eBioServer</h1><p>Your phone manages the connection through RRR. eBioServer credentials stay on the gym PC.</p><section class="rrr-panel"><h2>${escapeHtml(integration?.status || 'Not configured')}</h2><p>${integration?.device_serial ? `Selected device: ${escapeHtml(integration.device_name || integration.device_serial)} (${escapeHtml(integration.device_serial)})` : 'Pair the eBioServer Bridge from the licensed gym PC.'}</p><p>Commissioning: ${escapeHtml(integration?.commissioning_status || 'not started')} · ${integration?.records_synced || 0} records synced · ${integration?.unmapped_records || 0} unmapped</p>${devices.length ? `<h3>Devices reported by the gym-PC connector</h3>${devices.map(d => `<p>${escapeHtml(d.name)} · ${escapeHtml(d.serial_number)} · ${escapeHtml(d.status || 'unknown')} ${d.selected ? '· Selected' : `<button data-select-device="${d.id}">Select device</button>`}</p>`).join('')}` : '<p>No device inventory reported yet. Keep the paired connector running; it checks eBioServer through the gym PC.</p>'}<button id="rrr-pair">Generate pairing code</button><button id="rrr-mappings">Review unmapped punches</button><button id="rrr-rules">Signal thresholds</button><div id="rrr-pair-code"></div>${integration?.commissioning_status === 'attendance_verified' && !integration?.commands_enabled ? '<button id="rrr-commission">Enable after supervised door test</button>' : ''}</section></main>`;
  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelector('#rrr-mappings')?.addEventListener('click', () => navigate.push('rrr-mappings'));
  el.querySelector('#rrr-rules')?.addEventListener('click', () => navigate.push('rrr-rules'));
  el.querySelector('#rrr-pair')?.addEventListener('click', async () => {
    const pair = await apiRequest('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    const box = el.querySelector('#rrr-pair-code');
    box.textContent = pair.ok ? `Pairing code: ${pair.data.pairing_code} (expires ${new Date(pair.data.expires_at).toLocaleTimeString()})` : 'Could not create pairing code.';
  });
  el.querySelectorAll('[data-select-device]').forEach(button => button.addEventListener('click', async () => {
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/device`, {
      method: 'POST', body: { device_id: Number(button.dataset.selectDevice) },
    });
    if (response.ok) await load(el);
    else alert(response.error?.message || 'Could not select the device.');
  }));
  el.querySelector('#rrr-commission')?.addEventListener('click', async () => {
    if (!confirm('Confirm that a supervised physical door test passed.')) return;
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/commission`, { method: 'POST', body: { physical_test_passed: true } });
    if (response.ok) load(el);
  });
}
