/* Campaign Create Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderFormField, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js'; import { SEGMENT_LABELS, formatInteger, escapeHtml } from '../utils.js';
export default { async mount(el) {
  // V8-L23: last Preview & Count result (count + the segment it was for).
  let previewCount = null;
  let previewSegment = null;
  const segOpts = Object.entries(SEGMENT_LABELS).map(([v,l])=>({value:v,label:l}));
  const templRes = await apiRequest('/api/mobile/v1/campaigns/templates');
  const templates = templRes.ok ? templRes.data.templates||templRes.data||[] : [];
  const templOpts = templates.map(t=>({value:t.id||t.name,label:t.name||t.id}));
  el.innerHTML = `${renderHeader({title:'New Campaign',showBack:true})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <form id="cc-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${renderFormField({id:'cc-name',label:'Campaign Name',placeholder:'e.g. Monthly renewal reminder',required:true})}
      ${renderFormField({id:'cc-segment',label:'Target Segment',options:segOpts,required:true})}
      ${templOpts.length ? renderFormField({id:'cc-templ',label:'Message Template',options:templOpts}) : renderFormField({id:'cc-msg',label:'Message',type:'textarea',placeholder:'Hi {name}, your membership...',required:true})}
      <div id="cc-preview" class="card card-body hidden" style="background:var(--gray-50)">
        <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-sm)">Preview</div>
        <div id="cc-preview-text" style="font-size:var(--fs-sm);color:var(--text-secondary)"></div>
        <div id="cc-preview-count" style="font-size:var(--fs-sm);color:var(--brand);margin-top:var(--sp-sm)"></div>
      </div>
      <button type="button" class="btn btn-secondary btn-full" id="cc-preview-btn">${icon('eye',16)} Preview & Count</button>
      <button type="submit" class="btn btn-whatsapp btn-lg btn-full" id="cc-send">${icon('send',18,'white')} Send Campaign</button>
    </form>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
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
    const body = { name:el.querySelector('#cc-name').value.trim(), segment:el.querySelector('#cc-segment').value,
      template_id:el.querySelector('#cc-templ')?.value||null, message:el.querySelector('#cc-msg')?.value.trim()||null };
    const r = await apiRequest('/api/mobile/v1/campaigns',{method:'POST',body});
    if (r.ok) { showToast('Campaign launched!','success'); navigate.pop(); }
    else { showToast(r.error.message,'error'); btn.disabled = false; }
  });
}};
