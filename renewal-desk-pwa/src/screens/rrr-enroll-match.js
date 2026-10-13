import { apiRequest } from '../api.js';
import { navigate } from '../app.js';
import { escapeHtml } from '../utils.js';

export default { async mount(el) { await load(el); } };

const esc = escapeHtml;
let pollTimer = null;

const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

async function load(el) {
  stopPoll();
  el.innerHTML = '<div class="rrr-loading">Loading terminal user matches…</div>';
  const result = await apiRequest('/api/mobile/v1/rrr/enroll-matches');
  if (!result.ok) {
    el.innerHTML = `<main class="rrr-page rrr-detail"><h1>Match members unavailable</h1><p>Retry after reconnecting.</p><button id="rrr-retry">Retry</button></main>`;
    el.querySelector('#rrr-retry')?.addEventListener('click', () => load(el));
    return;
  }
  render(el, result.data);
}

function render(el, data) {
  const suggestions = data.suggestions || [];
  const unmatched = data.unmatched_terminal || [];
  const snapshot = data.snapshot;

  el.innerHTML = `<main class="rrr-page rrr-detail">
    <header class="rrr-header"><button id="rrr-back">← Integrations</button><div class="rrr-brand"><b>RRR</b><span>Match terminal users</span></div></header>
    <h1>Who is who on the terminal?</h1>
    <p>We read the names stored on your biometric terminal and matched them against your members. Confirm each match with one tap — nothing links without your approval.</p>
    ${snapshot ? `<p class="rrr-muted-copy">Terminal snapshot: ${snapshot.terminal_user_count} users · ${snapshot.source === 'adms' ? 'Direct Cloud' : 'Bridge'} · ${snapshot.acknowledged_at ? new Date(snapshot.acknowledged_at).toLocaleString() : ''}</p>` : ''}
    <div class="rrr-match-actions">
      <button id="rrr-scan" class="rrr-primary-button">Scan terminal users</button>
      <span id="rrr-scan-status" class="rrr-muted-copy"></span>
    </div>
    <p id="rrr-match-error" class="rrr-form-error" role="alert"></p>
    ${data.error === 'no_snapshot' && !suggestions.length ? '<p class="rrr-muted-copy">No terminal user list yet — hit <b>Scan terminal users</b> above, wait ~15 seconds, and this page will fill in.</p>' : ''}
    <section id="rrr-suggestions">
      ${suggestions.length ? '<h2>Suggested matches</h2>' + suggestions.map(suggestionCard).join('') : ''}
    </section>
    ${unmatched.length ? `<section><h2>Couldn't match confidently (${unmatched.length})</h2><p class="rrr-muted-copy">Ask staff who these are, then link them from the member profile.</p>${unmatched.map(u => `<article class="rrr-opportunity rrr-opportunity-muted"><div><h2>Terminal #${esc(u.enroll_number)}</h2><p>${esc(u.terminal_name || 'No name on terminal')}</p></div></article>`).join('')}</section>` : ''}
    ${!suggestions.length && !unmatched.length && snapshot ? '<p class="rrr-no-data">Everyone on the terminal is already linked. 🎉</p>' : ''}
  </main>`;

  el.querySelector('#rrr-back')?.addEventListener('click', () => { stopPoll(); navigate.back(); });
  el.querySelector('#rrr-scan')?.addEventListener('click', () => startScan(el));

  el.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', async () => {
    const memberId = button.dataset.memberId;
    const enrollNumber = button.dataset.enroll;
    const errorEl = el.querySelector('#rrr-match-error');
    button.disabled = true;
    button.textContent = 'Linking…';
    errorEl.textContent = '';
    const response = await apiRequest('/api/mobile/v1/rrr/enroll-matches/confirm', {
      method: 'POST', body: { member_id: Number(memberId), enroll_number: enrollNumber },
    });
    if (response.ok) {
      await load(el);
    } else {
      button.disabled = false;
      button.textContent = 'Confirm match';
      errorEl.textContent = response.error?.message || 'Could not link that member. Try again.';
    }
  }));
}

function suggestionCard(s) {
  const confidence = s.confidence >= 90 ? 'High confidence' : s.confidence >= 70 ? 'Good match' : 'Possible match';
  return `<article class="rrr-opportunity" data-suggestion="${esc(s.enroll_number)}">
    <div>
      <h2>Terminal #${esc(s.enroll_number)} · ${esc(s.terminal_name || 'No name')}</h2>
      <p>→ <b>${esc(s.member_name)}</b>${s.member_phone ? ` · ${esc(s.member_phone)}` : ''}</p>
      <p class="rrr-muted-copy">${confidence} (${s.confidence}%)</p>
    </div>
    <div><button class="rrr-primary-button" data-confirm data-member-id="${s.member_id}" data-enroll="${esc(s.enroll_number)}">Confirm match</button></div>
  </article>`;
}

async function startScan(el) {
  const button = el.querySelector('#rrr-scan');
  const status = el.querySelector('#rrr-scan-status');
  const errorEl = el.querySelector('#rrr-match-error');
  button.disabled = true;
  button.textContent = 'Scanning…';
  errorEl.textContent = '';
  status.textContent = 'Asking the terminal for its user list…';
  const response = await apiRequest('/api/mobile/v1/rrr/enroll-scan', { method: 'POST', body: {} });
  if (!response.ok) {
    button.disabled = false;
    button.textContent = 'Scan terminal users';
    status.textContent = '';
    errorEl.textContent = response.error?.message || 'Scan failed. Is the terminal connected?';
    return;
  }
  // Poll for the snapshot to arrive.
  let tries = 0;
  stopPoll();
  status.textContent = 'Waiting for the terminal to respond…';
  pollTimer = setInterval(async () => {
    tries += 1;
    const r = await apiRequest('/api/mobile/v1/rrr/enroll-matches');
    if (r.ok && (r.data.snapshot || r.data.suggestions?.length)) {
      stopPoll();
      render(el, r.data);
      return;
    }
    if (tries >= 20) {
      stopPoll();
      button.disabled = false;
      button.textContent = 'Scan terminal users';
      status.textContent = 'Still waiting — the terminal may be offline. It will respond when it reconnects; refresh this page then.';
    }
  }, 3000);
}
