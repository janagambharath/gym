import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

function directSettings() {
  return {
    host: new URL(window.location.origin).host,
    port: window.location.protocol === 'https:' ? '443' : '80',
    https: window.location.protocol === 'https:' ? 'On' : 'Off',
  };
}

async function load(el) {
  el.innerHTML = '<div class="rrr-loading">Preparing your connection workspace…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/integrations');
  const integrations = result.ok ? result.data.integrations || [] : [];
  const direct = integrations.find(x => x.type === 'adms_direct');
  const bridge = integrations.find(x => x.type === 'ebioserver');
  const devices = result.ok ? result.data.devices || [] : [];
  const settings = directSettings();
  const commandsResult = direct ? await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`) : null;
  const commands = commandsResult?.ok ? commandsResult.data.commands || [] : [];

  el.innerHTML = `<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">ELITE GYM · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${direct?.status === 'connected' ? 'Connected' : 'Step 1 of 3'}</b><span>${direct?.records_synced || 0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div><span class="rrr-status-pill ${direct?.status === 'connected' ? 'is-live' : ''}">${direct?.status === 'connected' ? 'LIVE' : 'RECOMMENDED'}</span><h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${direct ? directPanel(direct, settings, commands) : directForm()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${bridge ? `<div class="rrr-bridge-summary"><b>${escapeHtml(bridge.status || 'Not configured')}</b><span>${escapeHtml(bridge.device_name || bridge.device_serial || 'Awaiting device selection')}</span></div>` : '<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
        <button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button><div id="rrr-pair-code" class="rrr-code-box" hidden></div>
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${direct ? 'done' : ''}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${direct?.status === 'connected' ? 'done' : ''}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${direct?.last_success_at ? 'done' : ''}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${direct ? `<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${direct.unmapped_records || 0}) →</button>` : ''}
    </section>
    ${devices.length ? `<section class="rrr-device-list"><h2>Bridge device inventory</h2>${devices.map(d => `<div><b>${escapeHtml(d.name)}</b><span>${escapeHtml(d.serial_number)} · ${escapeHtml(d.status || 'unknown')}</span></div>`).join('')}</section>` : ''}
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> direct attendance is available now. Physical door block/unblock stays disabled until this exact terminal completes a supervised commissioning test and returns a verified command acknowledgement.</p></aside>
  </main>`;

  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.switchTab('dashboard'));
  el.querySelector('#rrr-mappings')?.addEventListener('click', () => navigate.push('rrr-mappings'));
  el.querySelector('#rrr-direct-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button');
    button.disabled = true; button.textContent = 'Saving terminal…';
    const response = await apiRequest('/api/mobile/v1/rrr/integrations/adms/provision', { method: 'POST', body: {
      device_serial: String(form.get('device_serial') || '').trim(),
      device_name: String(form.get('device_name') || '').trim(),
    }});
    if (response.ok) await load(el);
    else { button.disabled = false; button.textContent = 'Continue'; el.querySelector('#rrr-direct-error').textContent = response.error?.message || 'We could not save that terminal. Check the serial number.'; }
  });
  el.querySelector('#rrr-pair')?.addEventListener('click', async () => {
    const pair = await apiRequest('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    const box = el.querySelector('#rrr-pair-code'); box.hidden = false;
    box.textContent = pair.ok ? `Pairing code: ${pair.data.pairing_code} · expires ${new Date(pair.data.expires_at).toLocaleTimeString()}` : 'Could not create a pairing code.';
  });
  el.querySelectorAll('[data-adms-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.admsAction;
    const testEnrollNumber = el.querySelector('#rrr-test-enroll-number')?.value.trim();
    if (action !== 'probe_info' && !/^[1-9][0-9]{0,8}$/.test(testEnrollNumber || '')) {
      el.querySelector('#rrr-command-error').textContent = 'Enter the temporary device User ID first.';
      return;
    }
    button.disabled = true;
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`, {
      method: 'POST', body: { action, test_enroll_number: testEnrollNumber },
    });
    if (response.ok) await load(el);
    else { button.disabled = false; el.querySelector('#rrr-command-error').textContent = response.error?.message || 'The terminal did not accept another test yet.'; }
  }));
}

function directForm() {
  return `<form id="rrr-direct-form" class="rrr-direct-form"><label>Terminal serial number<input name="device_serial" autocomplete="off" placeholder="Example: X2008-123456" required></label><label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120"></label><p id="rrr-direct-error" class="rrr-form-error"></p><button class="rrr-primary-button" type="submit">Continue <span>→</span></button></form>`;
}

function directPanel(direct, settings, commands) {
  const latest = commands[0];
  const latestText = latest ? `${latest.action.replace('_', ' ')} · ${latest.status}${latest.result_code ? ` · result ${latest.result_code}` : ''}` : 'No commissioning command sent.';
  return `<div class="rrr-direct-live"><div class="rrr-device-identity"><b>${escapeHtml(direct.device_name || 'Elite Gym Entry')}</b><span>${escapeHtml(direct.device_serial)}</span></div><div class="rrr-server-card"><span>Cloud Server Address</span><code>${escapeHtml(settings.host)}</code><small>Port ${settings.port} · HTTPS ${settings.https} · Mode ADMS</small></div><p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch.</p><section class="rrr-command-console"><div><b>Live commissioning</b><span>${escapeHtml(latestText)}</span></div><button class="rrr-secondary-button" data-adms-action="probe_info">1. Send safe connection probe</button><label>Temporary device User ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label><div class="rrr-command-actions"><button class="rrr-test-block" data-adms-action="block_test">2. Test block</button><button class="rrr-test-unblock" data-adms-action="unblock_test">3. Test unblock</button></div><p id="rrr-command-error" class="rrr-form-error"></p></section></div>`;
}
