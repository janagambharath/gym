/* Campaign Create Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js'; import { SEGMENT_LABELS, formatInteger, escapeHtml, uuid } from '../utils.js';
export default { async mount(el) { await load(el); } };

async function load(el) {
  // V8-L23: last Preview & Count result (count + the segment it was for).
  let previewCount = null;
  let previewSegment = null;
  // V10-L25: one stable key per form, reused across retries of the same
  // campaign send (the backend honours it on campaign create).
  const campaignKey = uuid();
  const segOpts = Object.entries(SEGMENT_LABELS).map(([v,l])=>({value:v,label:l}));
  const templRes = await apiRequest('/api/mobile/v1/campaigns/templates');
  // V10-L21: a templates-leg failure used to silently swap the form to
  // free-text with no error — the owner could send an untemplated
  // message believing no templates exist. Fail loudly with retry, and
  // block Send until templates load. The free-text fallback stays only
  // for a load that SUCCEEDS with zero templates.
  const templatesFailed = !templRes.ok;
  const templates = templRes.ok ? templRes.data.templates||templRes.data||[] : [];
  const templOpts = templates.map(t=>({value:t.id||t.name,label:t.name||t.id}));
  el.innerHTML = `${renderHeader({title:'New Campaign',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <form id="cc-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({id:'cc-name',label:'Campaign Name',placeholder:'e.g. Monthly renewal reminder',required:true})}
      ${renderFormField({id:'cc-segment',label:'Target Segment',options:segOpts,required:true})}
      ${templatesFailed
        ? `<div class="card card-body" style="background:var(--critical-surface);border-color:var(--critical-border)"><div style="font-weight:var(--fw-bold);color:var(--critical)">Could not load message templates (${escapeHtml(templRes.error?.message || 'check your connection')}).</div><div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-top:var(--sp-xs)">Sending is blocked until templates load — retry below.</div><button type="button" class="btn btn-primary btn-sm" id="cc-templ-retry" style="margin-top:var(--sp-sm)">Try Again</button></div>`
        : (templOpts.length ? renderFormField({id:'cc-templ',label:'Message Template',options:templOpts}) : renderFormField({id:'cc-msg',label:'Message',type:'textarea',placeholder:'Hi {name}, your membership...',required:true}))}
      <div id="cc-preview" class="card card-body hidden" style="background:var(--gray-50)">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">Preview</div>
        <div id="cc-preview-text" style="font-size:var(--fs-sm);color:var(--text-secondary)"></div>
        <div id="cc-preview-count" style="font-size:var(--fs-sm);color:var(--brand);margin-top:var(--sp-sm)"></div>
      </div>
      <button type="button" class="btn btn-secondary btn-full" id="cc-preview-btn">${icon('eye',16)} Preview & Count</button>
      <button type="submit" class="btn btn-whatsapp btn-lg btn-full" id="cc-send" ${templatesFailed ? 'disabled' : ''}>${icon('send',18,'white')} Send Campaign</button>
    </form>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelector('#cc-templ-retry')?.addEventListener('click', () => load(el));
  // V10-L21: also disable Send in JS, not only via the `disabled`
  // attribute in the markup — the attribute alone is enough in a real
  // browser, but setting the property makes the blocked state explicit
  // and observable (and testable) everywhere.
  if (templatesFailed) { const sendBtn = el.querySelector('#cc-send'); if (sendBtn) sendBtn.disabled = true; }
  el.querySelector('#cc-preview-btn')?.addEventListener('click',async()=>{
    const seg = el.querySelector('#cc-segment')?.value;
    if (!seg) { showToast('Select a segment first','error'); return; }
    const r = await apiRequest(`/api/mobile/v1/campaigns/segments/preview?type=${seg}`);
    const prev = el.querySelector('#cc-preview');
    if (r.ok) {
      // V8-L23: remember the counted segment + count so the Send confirm
      // can show the real recipient number instead of "all recipients".
      previewCount = r.data.total ?? 0;
      previewSegment = seg;
      prev.classList.remove('hidden');
      el.querySelector('#cc-preview-count').textContent = `${formatInteger(r.data.total||0)} recipients will receive this message`;
      // The message itself: the chosen template's body, else the typed message.
      const templId = el.querySelector('#cc-templ')?.value;
      const templ = templates.find(t => String(t.id ?? t.name) === String(templId));
      const msg = templ?.body || templ?.message || templ?.text || templ?.content
        || el.querySelector('#cc-msg')?.value.trim() || '';
      el.querySelector('#cc-preview-text').textContent = msg || 'No message entered yet — pick a template or type a message above.';
    } else {
      // V3-L26: a failed preview used to fail silently — the button just
      // did nothing. Surface the error (the endpoint exists; keep the button).
      showToast(r.error?.message || 'Could not load the preview. Try again.', 'error');
    }
  });
  el.querySelector('#cc-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    // V10-L21 second guard (defence in depth — the Send button is
    // disabled too, but a programmatic submit must not slip past).
    if (templatesFailed) { showToast('Message templates failed to load — retry before sending.', 'error'); return; }
    // V8-L23: show the recipient count from the Preview & Count step in
    // the confirm — a wrong-segment mis-tap used to send blind. The count
    // only counts if the segment hasn't changed since the preview.
    const seg = el.querySelector('#cc-segment')?.value;
    const countText = (previewCount != null && previewSegment === seg)
      ? `This will send messages to ${formatInteger(previewCount)} recipient${previewCount === 1 ? '' : 's'}. Continue?`
      : 'This will send messages to all recipients. Continue?';
    const yes = await showConfirm({title:'Send Campaign',message:countText,confirmText:'Send'});
    if (!yes) return;
    const btn = el.querySelector('#cc-send'); btn.disabled = true;
    // V11-C1: the backend reads ONLY segment_type / whatsapp_template_name
    // / message_template (app/mobile_api/campaigns.py:181,199-200) — the
    // old {segment, template_id, message} keys were all silently ignored,
    // so every campaign was built against the default all_expired segment
    // with no template. Template ids ARE the Meta template names
    // (get_approved_templates returns id == name), so the chosen template
    // id is the whatsapp_template_name; the typed message (free-text path)
    // or the template body is the message_template the send path uses
    // for offer/announcement text.
    const templId = el.querySelector('#cc-templ')?.value || null;
    const templ = templId ? templates.find(t => String(t.id ?? t.name) === String(templId)) : null;
    const body = { name: el.querySelector('#cc-name').value.trim(),
      segment_type: el.querySelector('#cc-segment').value,
      whatsapp_template_name: templId,
      message_template: el.querySelector('#cc-msg')?.value.trim()
        || templ?.body || templ?.message || templ?.text || templ?.content || null };
    const r = await apiRequest('/api/mobile/v1/campaigns', { method: 'POST', body, headers: { 'Idempotency-Key': campaignKey } });
    if (!r.ok) { showToast(r.error.message, 'error'); btn.disabled = false; return; }
    // V11-C1: POST /campaigns creates a DRAFT only. Send it now (same
    // create-then-send flow as Android's onLaunchCampaign) and toast
    // "launched" ONLY after the send returns — a create-only success is
    // a saved draft, never a launch.
    const campaignId = r.data?.id;
    const sendRes = await apiRequest(`/api/mobile/v1/campaigns/${campaignId}/send`, { method: 'POST' });
    if (sendRes.ok) {
      const sent = sendRes.data?.sent, total = sendRes.data?.total, failed = sendRes.data?.failed;
      showToast(
        (typeof sent === 'number' && typeof total === 'number')
          ? `Campaign launched! Sent to ${formatInteger(sent)} of ${formatInteger(total)} members${failed > 0 ? ` (${formatInteger(failed)} failed)` : ''}.`
          : 'Campaign launched!',
        'success');
      navigate.pop();
    } else {
      // The draft exists — do NOT claim a launch. Land on its detail
      // page (which has a Send button for draft/failed campaigns) so the
      // owner can retry sending this same campaign instead of creating
      // a duplicate.
      showToast(`Campaign saved as a draft — sending failed (${sendRes.error?.message || 'try again from the campaign detail'}).`, 'error');
      navigate.push('campaign-detail', { campaignId: String(campaignId) });
    }
  });
}
