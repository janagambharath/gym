import { apiRequest, getCachedSession } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default {
  async mount(el) { await load(el); },
  async unmount() { stopPoll(); },
};

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
  const seenAt = integration?.last_seen_at || integration?.last_success_at;
  if (!integration || integration.status !== 'connected' || !seenAt) return false;
  return Date.now() - new Date(seenAt).getTime() < 5 * 60 * 1000;
}

function livePill(integration) {
  if (isLive(integration)) return '<span class="rrr-status-pill is-live">LIVE</span>';
  const seenAt = integration?.last_seen_at || integration?.last_success_at;
  if (seenAt) return `<span class="rrr-status-pill">LAST SEEN ${esc(timeAgo(seenAt).toUpperCase())}</span>`;
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
      <article class="rrr-connect-card">
        <div class="rrr-card-top"><span class="rrr-option-icon">💻</span><div><h2>TCP Bridge (.exe)</h2><p>Custom Windows bridge for direct terminal connection.</p></div></div>
        <p class="rrr-muted-copy">For gyms using the Renewal Desk Bridge .exe on a Windows PC. Download the latest build, enter the pairing code, and it connects directly to your terminal via TCP.</p>
        <button class="rrr-btn rrr-btn-outline" id="rrr-tcp-guide">Download bridge .exe</button>
      </article>
    </section>
    <section class="rrr-steps-panel">
      <div class="rrr-panel-head"><div><span class="rrr-eyebrow">WHAT HAPPENS NEXT</span><h2>Three small steps. Then RRR takes over.</h2></div></div>
      <ol class="rrr-setup-steps">
        <li class="${direct ? 'done' : ''}"><b>1</b><div><strong>Register the terminal</strong><span>Save the terminal serial number in RRR.</span></div></li>
        <li class="${direct && isLive(direct) ? 'done' : ''}"><b>2</b><div><strong>Point it to RRR Cloud</strong><span>Enter the server address shown above in Cloud Server Settings.</span></div></li>
        <li class="${(direct?.records_synced || 0) > 0 ? 'done' : ''}"><b>3</b><div><strong>Make one real punch</strong><span>RRR confirms the event, then you map any unknown member once.</span></div></li>
      </ol>
      ${(direct || bridge) ? `<button class="rrr-link-button" id="rrr-mappings">Review unknown punches (${unmapped}) →</button>
    <button class="rrr-link-button" id="rrr-enroll-match">Match terminal users to members →</button>` : ''}
    </section>
    <aside class="rrr-safety-note"><span>ⓘ</span><p><b>Access-control safety:</b> attendance flows as soon as the terminal connects. Automatic door block/unblock for expired members switches on only after the supervised commissioning below — a real punch, a verified test command, and a physical door test you confirm in person.</p></aside>

  </main>`;

  el.querySelector('#rrr-back')?.addEventListener('click', () => navigate.back());
  el.querySelector('#rrr-mappings')?.addEventListener('click', () => navigate.push('rrr-mappings'));
  el.querySelector('#rrr-enroll-match')?.addEventListener('click', () => navigate.push('rrr-enroll-match'));
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
    ${connected ? '' : `
      <div class="rrr-empty-state">
        <b>${direct.last_seen_at ? 'This terminal has not polled recently.' : "We haven't heard from this terminal yet."}</b>
        ${direct.last_seen_at ? `<p>Last terminal poll: ${esc(timeAgo(direct.last_seen_at))}.</p>` : ''}
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
    ${settings.token_present ? `
    <div class="rrr-empty-state" id="rrr-rotate-box">
      <b>Connection values hidden.</b>
      <p>The token for this terminal is stored securely and can't be shown again — that's why the address and port above are blank. Rotate to get fresh values.</p>
      <button class="rrr-secondary-button" id="rrr-rotate-token" type="button">Rotate token — get fresh values</button>
      <p id="rrr-rotate-error" class="rrr-form-error" role="alert"></p>
      <div id="rrr-serial-box"></div>
    </div>` : ''}
    <p class="rrr-muted-copy">On the terminal: <b>Menu → Comm. → Cloud Server Setting</b>. Save these values, then make one test punch. ${settings.https ? '<b>Important:</b> if your terminal has no HTTPS/SSL option in its menu, it cannot use Direct Cloud — use the eBioServer bridge instead.' : '<b>Note:</b> this terminal talks plain HTTP — keep it on a trusted network or use a VPN.'}</p>
    <section class="rrr-command-console">
      <div><b>Live commissioning</b><span id="rrr-cmd-progress">${latest ? progressText(latest) : 'No commissioning command sent yet.'}</span></div>
      <button class="rrr-secondary-button" data-adms-action="probe_info" ${connected ? '' : 'disabled'}>1. Send safe connection probe</button>
      ${connected ? '' : '<p class="rrr-muted-copy">Buttons unlock once the terminal phones home — finish step 2 above first.</p>'}
      <label>Enrolled test-user ID<input id="rrr-test-enroll-number" inputmode="numeric" pattern="[0-9]*" placeholder="Example: 999"></label>
      <label>Current name shown on terminal<input id="rrr-test-user-name" maxlength="24" autocomplete="off" placeholder="Enter the exact test-user name"></label>
      <label class="rrr-test-confirm"><input id="rrr-test-member-confirm" type="checkbox"> I confirm this is the dedicated fake test account I created, not a real customer.</label>
      <div class="rrr-command-actions">
        <button class="rrr-test-block" data-adms-action="essl_group_block_test" ${connected ? '' : 'disabled'}>2. Test eSSL block (Grp=100)</button>
        <button class="rrr-test-unblock" data-adms-action="essl_group_unblock_test" ${connected ? '' : 'disabled'}>3. Test eSSL unblock (Grp=1)</button>
      </div>
      <p class="rrr-muted-copy">Use only the dedicated, fingerprint-enrolled fake account you created. A fake account saved as a Renewal Desk member is accepted when its current terminal name exactly matches the member name. The command updates USERINFO with Grp=100 or Grp=1 and does not use DELETE. After each terminal acknowledgement, test the same finger at the device; the acknowledgement alone does not prove access changed or that the fingerprint remained enrolled. These tests do not enable automatic membership commands.</p>
      <details class="rrr-danger-probes">
        <summary>Advanced destructive fingerprint probes</summary>
        <p class="rrr-muted-copy">These commands delete fingerprint template data for the test ID. You will need to enroll it again; they are not needed for the Grp test above.</p>
        <div class="rrr-command-actions">
          <button class="rrr-secondary-button" data-adms-action="delete_biodata_test" ${connected ? '' : 'disabled'}>Delete fingerprints (FINGERTMP)</button>
          <button class="rrr-secondary-button" data-adms-action="delete_fingertmp_test" ${connected ? '' : 'disabled'}>Delete finger 0 (FID=0)</button>
        </div>
      </details>
      <p id="rrr-command-error" class="rrr-form-error" role="alert"></p>
    </section>
    ${commissionBox('direct', direct, commands)}
  </div>`;
}

function progressText(cmd) {
  const rawAction = String(cmd.action || '');
  const action = esc(rawAction.replace(/_/g, ' '));
  if (cmd.status === 'acked' && rawAction === 'essl_group_block_test') {
    return '✓ Grp=100 update acknowledged. Check that the test ID is denied at the terminal.';
  }
  if (cmd.status === 'acked' && rawAction === 'essl_group_unblock_test') {
    return '✓ Grp=1 update acknowledged. Check that the same fingerprint works again.';
  }
  if (cmd.status === 'acked') return `✓ ${action} — terminal acknowledged.`;
  if (cmd.status === 'failed') {
    if (cmd.result_message) return `✗ ${action} — ${esc(cmd.result_message)}`;
    return `✗ ${action} — terminal reported failure${cmd.result_code ? ` (result ${esc(cmd.result_code)})` : ''}. Check the device and retry.`;
  }
  if (cmd.status === 'delivered') return `… ${action} — terminal received it, waiting for acknowledgement.`;
  return `… ${action} — sent, waiting for the terminal to pick it up.`;
}

function wireDirectPanel(el, direct, commands) {
  el.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyText(button.dataset.copy, button)));
  el.querySelector('#rrr-rotate-token')?.addEventListener('click', async () => {
    const button = el.querySelector('#rrr-rotate-token');
    const errorEl = el.querySelector('#rrr-rotate-error');
    const box = el.querySelector('#rrr-rotate-box');
    if (!window.confirm('Rotate the connection token? You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days.')) return;
    button.disabled = true;
    button.textContent = 'Rotating…';
    errorEl.textContent = '';
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/rotate-token`, { method: 'POST', body: {} });
    if (!response.ok) {
      button.disabled = false;
      button.textContent = 'Rotate token — get fresh values';
      errorEl.textContent = apiMessage(response, 'Could not rotate the token. Try again.');
      return;
    }
    const s = response.data.terminal_settings || {};
    box.outerHTML = `<div class="rrr-server-card" id="rrr-fresh-settings">
      <span class="rrr-server-card-title">Fresh values — copy them NOW</span>
      <p class="rrr-muted-copy"><b>Shown once.</b> ${esc(response.data.warning || 'Save these in the terminal before leaving this screen.')}</p>
      ${copyRow('Cloud Server Address', s.server_address || '—')}
      ${copyRow('Port', String(s.server_port ?? '—'))}
      ${copyRow('HTTPS', s.https ? 'On' : 'Off')}
      ${copyRow('Path', s.path || '/iclock')}
      ${copyRow('Mode', s.server_mode || 'ADMS')}
    </div>`;
    el.querySelectorAll('#rrr-fresh-settings [data-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
  });
  const paintSerialBox = (on) => {
    const box = el.querySelector('#rrr-serial-box');
    if (!box) return;
    box.innerHTML = on ? `
      <p class="rrr-muted-copy"><b>Serial-number login is ON</b> for this terminal — it connects with address + port only, no token needed.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Turn off serial login</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>` : `
      <p class="rrr-muted-copy"><b>No path/URL field on your terminal?</b> Some terminals can't send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.</p>
      <button class="rrr-secondary-button" id="rrr-serial-fallback" type="button">Connect with serial number instead</button>
      <p id="rrr-serial-error" class="rrr-form-error" role="alert"></p>`;
    box.querySelector('#rrr-serial-fallback')?.addEventListener('click', () => toggleSerial(!on));
  };
  const toggleSerial = async (enabling) => {
    const button = el.querySelector('#rrr-serial-fallback');
    const errorEl = el.querySelector('#rrr-serial-error');
    if (!button) return;
    if (!window.confirm(enabling
      ? 'Let this terminal log in with its serial number? It will connect with just the server address and port — no token needed. You can turn this off again any time.'
      : 'Turn off serial-number login? This terminal will stop connecting until it uses the token path.')) return;
    button.disabled = true;
    button.textContent = 'Switching…';
    if (errorEl) errorEl.textContent = '';
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/serial-fallback`, { method: 'POST', body: { enabled: enabling } });
    if (!response.ok) {
      button.disabled = false;
      button.textContent = enabling ? 'Connect with serial number instead' : 'Turn off serial login';
      if (errorEl) errorEl.textContent = apiMessage(response, 'Could not switch login mode. Try again.');
      return;
    }
    paintSerialBox(enabling);
  };
  paintSerialBox(!!direct.allow_serial_fallback);
  el.querySelectorAll('[data-adms-action]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.admsAction;
    const errorEl = el.querySelector('#rrr-command-error');
    const testEnrollNumber = el.querySelector('#rrr-test-enroll-number')?.value.trim();
    const testUserName = el.querySelector('#rrr-test-user-name')?.value.trim();
    const testMemberConfirmed = !!el.querySelector('#rrr-test-member-confirm')?.checked;
    const groupTest = ['essl_group_block_test', 'essl_group_unblock_test'].includes(action);
    if (action !== 'probe_info' && !/^[1-9][0-9]{0,8}$/.test(testEnrollNumber || '')) {
      errorEl.textContent = 'Enter the enrolled, terminal-local test-user ID first (digits only).';
      return;
    }
    if (groupTest && !testUserName) {
      errorEl.textContent = 'Enter the test user’s current name exactly as it appears on the terminal.';
      return;
    }
    if (groupTest && !testMemberConfirmed) {
      errorEl.textContent = 'Confirm this is the fake test account you created before sending the Group test.';
      return;
    }
    if (action === 'essl_group_block_test' && !window.confirm(`Queue a Grp=100 USERINFO update for fake test ID ${testEnrollNumber}? If this ID is linked to a Renewal Desk member, its name must match exactly. This may update the displayed name to “${testUserName}”.`)) return;
    if (action === 'essl_group_unblock_test' && !window.confirm(`Queue a Grp=1 USERINFO update for fake test ID ${testEnrollNumber}? If linked to a Renewal Desk member, its name must match exactly. Verify the same fingerprint at the terminal after acknowledgement.`)) return;
    errorEl.textContent = '';
    el.querySelectorAll('[data-adms-action]').forEach(b => { b.disabled = true; });
    const body = { action, test_enroll_number: testEnrollNumber };
    if (groupTest) {
      body.test_user_name = testUserName;
      body.test_member_confirmed = true;
    }
    const response = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`, {
      method: 'POST', body,
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
    return `<section class="rrr-commission is-on"><b>✓ Automatic block/unblock is ON</b><p>Expired members are blocked and renewed members are restored automatically on this terminal.</p>${kind === 'direct' ? '<p><b>Direct ADMS:</b> automatic blocks use the tested Grp=100 update; renewal restores Grp=1, keeping fingerprints enrolled.</p>' : ''}</section>`;
  }
  const hasAttendance = (integration.records_synced || 0) > 0;
  const hasAckedBlock = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && c.action === 'essl_group_block_test')
    : true;
  const hasAckedUnblock = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && c.action === 'essl_group_unblock_test')
    : true;
  const hasAckedTests = hasAckedBlock && hasAckedUnblock;
  const check = (done, label) => `<li class="${done ? 'done' : ''}"><i>${done ? '✓' : '○'}</i><span>${label}</span></li>`;
  const directChecks = kind === 'direct'
    ? check(hasAckedBlock, 'The Grp=100 block test was acknowledged')
      + check(hasAckedUnblock, 'The Grp=1 restore test was acknowledged')
    : '';
  return `<section class="rrr-commission">
    <b>Supervised commissioning</b>
    <p>Stand at the door with the terminal. Automatic block/unblock switches on only after:</p>
    ${kind === 'direct' ? '<p><b>Direct ADMS:</b> automation uses the tested Grp=100 block and Grp=1 restore; it keeps the terminal user and fingerprint enrolled.</p>' : ''}
    <ol class="rrr-checklist">
      ${check(hasAttendance, 'A real member punch reached RRR')}
      ${directChecks}
      ${check(false, 'You watched the door stay locked on test block and open on test unblock')}
    </ol>
    <label class="rrr-confirm"><input type="checkbox" id="rrr-door-confirm-${kind}"> I stood at the door and verified the lock behaviour myself.</label>
    <button class="rrr-primary-button" id="rrr-commission-btn-${kind}" disabled>Enable automatic block/unblock</button>
    <p id="rrr-commission-error-${kind}" class="rrr-form-error" role="alert"></p>
  </section>`;
}

function wireCommission(el, kind, integration, commands = []) {
  const checkbox = el.querySelector(`#rrr-door-confirm-${kind}`);
  const button = el.querySelector(`#rrr-commission-btn-${kind}`);
  const errorEl = el.querySelector(`#rrr-commission-error-${kind}`);
  if (!checkbox || !button) return;
  const hasAttendance = (integration.records_synced || 0) > 0;
  const hasAckedBlock = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && c.action === 'essl_group_block_test')
    : true;
  const hasAckedUnblock = kind === 'direct'
    ? commands.some(c => c.status === 'acked' && c.action === 'essl_group_unblock_test')
    : true;
  const hasAckedTests = hasAckedBlock && hasAckedUnblock;
  const ready = () => checkbox.checked && hasAttendance && hasAckedTests;
  checkbox.addEventListener('change', () => { button.disabled = !ready(); });
  if (!ready()) {
    const hint = document.createElement('p');
    hint.className = 'rrr-muted-copy';
    hint.textContent = kind === 'direct' && !hasAckedTests
      ? 'Run both eSSL Group tests and wait for the Grp=100 and Grp=1 acknowledgements.'
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
