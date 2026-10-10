import { apiRequest, getCachedSession } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;
let pollTimer = null;
const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function isLive(integration) {
  if (!integration || integration.status !== 'connected' || !integration.last_success_at) return false;
  return Date.now() - new Date(integration.last_success_at).getTime() < 5 * 60 * 1000;
}

function livePill(integration) {
  if (isLive(integration)) return '<span class="rrr-status-pill is-live">LIVE</span>';
  if (integration?.last_success_at) return `<span class="rrr-status-pill">LAST SEEN ${esc(timeAgo(integration.last_success_at).toUpperCase())}</span>`;
  return '<span class="rrr-status-pill">NOT CONNECTED</span>';
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* noop */ }
    ta.remove();
  }
  if (button) {
    const original = button.textContent;
    button.textContent = 'Copied ✓'; button.classList.add('copied');
    setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1600);
  }
}

function apiMessage(response, fallback) {
  return esc(response?.error?.message || response?.data?.message || fallback);
}

async function load(el) {
  stopPoll();
  el.innerHTML = '<div class="rrr-loading">Preparing your connection workspace…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/integrations');
  const integrations = result.ok ? result.data.integrations || [] : [];
  const direct = integrations.find(x => x.type === 'adms_direct');
  const bridge = integrations.find(x => x.type === 'ebioserver');
  const devices = result.ok ? result.data.devices || [] : [];
  const commandsResult = direct ? await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`) : null;
  const commands = commandsResult?.ok ? commandsResult.data.commands || [] : [];
  const unmapped = Math.max(direct?.unmapped_records || 0, bridge?.unmapped_records || 0);

  el.innerHTML = `<main class="rrr-page rrr-integrations-page">
    <header class="rrr-header rrr-integrations-header">
      <button id="rrr-back" class="rrr-back-button" aria-label="Back">←</button>
      <div class="rrr-brand"><b>RRR</b><span>Gym Growth System</span></div>
      <span class="rrr-help-label">Device setup</span>
    </header>
    <section class="rrr-setup-hero">
      <div><span class="rrr-eyebrow">${escapeHtml((getCachedSession()?.tenantName || 'YOUR GYM').toUpperCase())} · ATTENDANCE</span><h1>Connect your terminal, not another computer.</h1><p>Choose Direct Cloud for the cleanest setup. RRR receives attendance securely from your eSSL device and turns it into member actions.</p></div>
      <div class="rrr-setup-progress"><b>${direct && isLive(direct) ? 'Connected' : 'Step 1 of 3'}</b><span>${direct?.records_synced || 0} verified records</span></div>
    </section>
    <section class="rrr-connection-grid">
      <article class="rrr-connect-card rrr-connect-card-primary">
        <div class="rrr-card-top"><span class="rrr-option-icon">☁</span><div>${livePill(direct)}<h2>Direct Cloud</h2><p>No gym PC or bridge required for attendance.</p></div></div>
        ${direct ? directPanel(direct, commands) : directForm()}
      </article>
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon rrr-option-muted">⌘</span><div><span class="rrr-status-pill">FALLBACK</span><h2>eBioServer Bridge</h2><p>Use only when your licensed eBioServer stays on a gym PC.</p></div></div>
        ${bridgeCard(bridge, devices)}
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${direct ? 'done' : ''}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${direct && isLive(direct) ? 'done' : ''}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(direct?.records_synced || 0) > 0 ? 'done' : ''}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${(direct || bridge) ? `<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${unmapped}) →</button>` : ''}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>
  </main>`;

  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
  el.querySelector('#rrr-mappings')?.addEventListener('click', () => navigate.push('rrr-mappings'));
  wireDirectForm(el);
  wireBridge(el, bridge, devices);
  if (direct) wireDirectPanel(el, direct, commands);
}

function wireDirectForm(el) {
  el.querySelector('#rrr-direct-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const errorEl = el.querySelector('#rrr-direct-error');
    button.disabled = true; button.textContent = 'Saving terminal…';
    errorEl.textContent = '';
    const response = await apiRequest('/api/mobile/v1/rrr/integrations/adms/provision', { method: 'POST', body: {
      device_serial: String(new FormData(form).get('device_serial') || '').trim(),
      device_name: String(new FormData(form).get('device_name') || '').trim(),
    }});
    if (response.ok) await load(el);
    else {
      button.disabled = false; button.textContent = 'Continue →';
      errorEl.textContent = apiMessage(response, 'We could not save that terminal. Check the serial number and try again.');
    }
  });
}

function directForm() {
  return `<form id="rrr-direct-form" class="rrr-direct-form">
    <label>Terminal serial number
      <input name="device_serial" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Example: X2008-123456" required>
    </label>
    <label>Friendly name <input name="device_name" value="Elite Gym Entry" maxlength="120" autocapitalize="off"></label>
    <p id="rrr-direct-error" class="rrr-form-error" role="alert"></p>
    <button class="rrr-primary-button" type="submit">Continue <span>→</span></button>
  </form>`;
}

function copyRow(label, value) {
  return `<div class="rrr-copy-row"><div><span>${esc(label)}</span><code>${esc(value)}</code></div><button type="button" class="rrr-copy-btn" data-copy="${esc(value)}">Copy</button></div>`;
}

function directPanel(direct, commands) {
  const settings = direct.terminal_settings || {};
  const connected = isLive(direct);
  const latest = commands[0];
  return `<div class="rrr-direct-live">
    <div class="rrr-device-identity"><b>${esc(direct.device_name || 'Elite Gym Entry')}</b><span>Serial ${esc(direct.device_serial || '')}</span></div>
    ${direct.status === 'connected' || direct.last_success_at ? '' : `
      <div class="rrr-empty-state">
        <b>We haven't heard from this terminal yet.</b>
        ${direct.last_error ? `<p>Last error: ${esc(direct.last_error)}</p>` : ''}
        <p>Checklist: ① the values below are saved in <b>Menu → Comm. → Cloud Server Setting</b>, ② the terminal has internet access, ③ the serial matches the sticker on the device.</p>
      </div>`}
    <div class="rrr-server-card">
      <span class="rrr-server-card-title">Type these into the terminal</span>
      ${copyRow('Cloud Server Address', settings.server_address || '—')}
      ${copyRow('Port', String(settings.server_port ?? '—'))}
      ${copyRow('HTTPS', settings.https ? 'On' : 'Off')}
      ${copyRow('Path', settings.path || '/iclock')}
      ${copyRow('Mode', settings.server_mode || 'ADMS')}
    </div>
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${settings.https ? '' : '<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN.'}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${latest ? progressText(latest) : 'No commissioning command sent yet.'}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${connected ? '' : 'disabled'}>1. Send safe connection probe</button>
      ${connected ? '' : '<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Temporary device User ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="block_test" ${connected ? '' : 'disabled'}>2. Test block</button>
        <button class="rrr-test-unblock" data-adms-action="unblock_test" ${connected ? '' : 'disabled'}>3. Test unblock</button>
      </div>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${commissionBox('direct', direct, commands)}
  </div>`;
}

function progressText(cmd) {
  const action = esc(String(cmd.action || '').replace(/_/g, ' '));
  if (cmd.status === 'acked') return `✓ ${action} — terminal acknowledged.`;
  if (cmd.status === 'failed') return `✗ ${action} — terminal reported failure${cmd.result_code ? ` (result ${esc(cmd.result_code)})` : ''}. Check the device and retry.`;
  if (cmd.status === 'delivered') return `… ${action} — terminal received it, waiting for acknowledgement.`;
  return `… ${action} — sent, waiting for the terminal to pick it up.`;
}

function wireDirectPanel(el, direct, commands) {
  el.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyText(button.dataset.copy, button)));
  el.querySelectorAll('[data-adms-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.admsAction;
    const errorEl = el.querySelector('#rrr-command-error');
    const testEnrollNumber = el.querySelector('#rrr-test-enroll-number')?.value.trim();
    if (action !== 'probe_info' && !/^[1-9][0-9]{0,8}$/.test(testEnrollNumber || '')) {
      errorEl.textContent = 'Enter the temporary device User ID first (digits only, e.g. 999).';
      return;
    }
    errorEl.textContent = '';
    el.querySelectorAll('[data-adms-action]').forEach(b => { b.disabled = true; });
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`, {
      method: 'POST', body: { action, test_enroll_number: testEnrollNumber },
    });
    if (!response.ok) {
      el.querySelectorAll('[data-adms-action]').forEach(b => { b.disabled = false; });
      errorEl.textContent = apiMessage(response, 'The terminal did not accept another test yet.');
      return;
    }
    pollCommand(el, direct.id, response.data.command.id);
  }));
  wireCommission(el, 'direct', direct, commands);
}

function pollCommand(el, integrationId, commandId) {
  stopPoll();
  const progressEl = () => el.querySelector('#rrr-cmd-progress');
  let tries = 0;
  const tick = async () => {
    tries += 1;
    const r = await apiRequest(`/api/mobile/v1/rrr/integrations/${integrationId}/adms/commands`);
    const list = r.ok ? r.data.commands || [] : [];
    const cmd = list.find(c => c.id === commandId) || list[0];
    if (cmd && progressEl()) progressEl().textContent = progressText(cmd);
    if (!cmd || tries >= 24 || cmd.status === 'acked' || cmd.status === 'failed') {
      stopPoll();
      if (tries >= 24 && cmd && !['acked', 'failed'].includes(cmd.status) && progressEl()) {
        progressEl().textContent = 'Still waiting — the terminal may be offline. It will pick the command up when it reconnects.';
      }
      if (cmd && ['acked', 'failed'].includes(cmd.status)) setTimeout(() => load(el), 1500);
      return;
    }
  };
  tick();
  pollTimer = setInterval(tick, 2500);
}

function commissionBox(kind, integration, commands = []) {
  if (integration.commands_enabled) {
    return `<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p></section>`;
  }
  const hasAttendance = (integration.records_synced || 0) > 0;
  const hasAckedTest = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && ['probe_info', 'block_test', 'unblock_test'].includes(c.action))
    : true;
  const check = (done, label) => `<li class="${done ? 'done' : ''}"><i>${done ? '✓' : '○'}</i><span>${label}</span></li>`;
  return `<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    <ol class="rrr-checklist">
      ${check(hasAttendance, 'A real member punch reached RRR')}
      ${kind === 'direct' ? check(hasAckedTest, 'A test command was acknowledged by the terminal') : ''}
      ${check(false, 'You watched the door stay locked on test block and open on test unblock')}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error" class="rrr-form-error" role="alert"></p>
  </section>`;
}

function wireCommission(el, kind, integration, commands = []) {
  const checkbox = el.querySelector('#rrr-door-confirm');
  const button = el.querySelector('#rrr-commission-btn');
  const errorEl = el.querySelector('#rrr-commission-error');
  if (!checkbox || !button) return;
  const hasAttendance = (integration.records_synced || 0) > 0;
  const hasAckedTest = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && ['probe_info', 'block_test', 'unblock_test'].includes(c.action))
    : true;
  const ready = () => checkbox.checked && hasAttendance && hasAckedTest;
  checkbox.addEventListener('change', () => { button.disabled = !ready(); });
  if (!ready()) {
    const hint = document.createElement('p');
    hint.className = 'rrr-muted-copy';
    hint.textContent = kind === 'direct' && !hasAckedTest
      ? 'The button unlocks after a test command above is acknowledged by the terminal.'
      : 'The button unlocks after the first real punch above reaches RRR.';
    button.after(hint);
  }
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Enabling…';
    errorEl.textContent = '';
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/commission`, {
      method: 'POST', body: { physical_test_passed: true },
    });
    if (response.ok) { await load(el); return; }
    button.disabled = false; button.textContent = 'Enable automatic block/unblock';
    errorEl.textContent = apiMessage(response, 'Commissioning failed. Finish the checklist above and try again.');
  });
}

function bridgeCard(bridge, devices) {
  const paired = bridge && ['connected', 'paired'].includes(bridge.status);
  const mine = bridge ? devices.filter(d => d.integration_id === bridge.id) : [];
  return `
    ${bridge ? `<div class="rrr-bridge-summary"><b>${esc(paired ? 'Bridge connected' : (bridge.status || 'Not configured'))}</b><span>${esc(bridge.device_name || bridge.device_serial || 'Awaiting device selection')}</span></div>` : '<p class="rrr-muted-copy">Not needed for Direct Cloud. It remains available for existing eBioServer installations.</p>'}
    ${bridge && mine.length ? `<div class="rrr-device-list rrr-device-list-inline"><h2>Devices reported by the bridge</h2>${mine.map(d => `
      <div class="rrr-device-row"><div><b>${esc(d.name || 'Terminal')}</b><span>${esc(d.serial_number || '')} · ${esc(d.status || 'unknown')}</span></div>
      ${d.selected ? '<span class="rrr-selected-pill">Selected ✓</span>' : `<button class="rrr-secondary-button rrr-device-select" data-device-id="${d.id}">Select</button>`}
      </div>`).join('')}</div>` : ''}
    ${bridge ? commissionBox('ebio', bridge) : ''}
    <div class="rrr-pair-row">
      ${paired
        ? `<button class="rrr-link-button" id="rrr-pair">Generate a new code</button>`
        : `<button class="rrr-secondary-button" id="rrr-pair">Generate bridge pairing code</button>`}
    </div>
    <div id="rrr-pair-code" class="rrr-code-box" hidden></div>`;
}

function wireBridge(el, bridge, devices) {
  el.querySelector('#rrr-pair')?.addEventListener('click', async () => {
    const pair = await apiRequest('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    const box = el.querySelector('#rrr-pair-code');
    box.hidden = false;
    if (!pair.ok) { box.innerHTML = `<span>${apiMessage(pair, 'Could not create a pairing code.')}</span>`; return; }
    box.innerHTML = `<div class="rrr-code-row"><b>${esc(pair.data.pairing_code)}</b><button class="rrr-copy-btn" id="rrr-copy-code">Copy</button></div><small>Valid for <b>10 minutes</b> — expires ${esc(new Date(pair.data.expires_at).toLocaleTimeString())}. Type it into the eBioServer Bridge on the gym PC.</small>`;
    box.querySelector('#rrr-copy-code')?.addEventListener('click', event => copyText(pair.data.pairing_code, event.currentTarget));
  });
  el.querySelectorAll('.rrr-device-select').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    const integrationId = bridge.id;
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${integrationId}/device`, {
      method: 'POST', body: { device_id: Number(button.dataset.deviceId) },
    });
    if (response.ok) await load(el);
    else { button.disabled = false; button.textContent = apiMessage(response, 'Could not select that device.'); }
  }));
  if (bridge) wireCommission(el, 'ebio', bridge);
}
