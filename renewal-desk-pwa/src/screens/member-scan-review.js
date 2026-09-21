/* Member Scan Review Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, showToast } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
export default { mount(el, params) {
  const members = params?.members ? JSON.parse(params.members) : [];
  el.innerHTML = `${renderHeader({title:`Review (${members.length})`,showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-lg)">
    <div class="card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm)">
        <thead><tr style="background:var(--gray-50)">
          <th style="padding:var(--sp-sm);text-align:left">Name</th>
          <th style="padding:var(--sp-sm);text-align:left">Phone</th>
          <th style="padding:var(--sp-sm);text-align:left">Plan</th>
        </tr></thead>
        <tbody>${members.map((m,i)=>`<tr style="border-top:1px solid var(--border-light)">
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${escapeHtml(m.name||'')}" data-idx="${i}" data-field="name"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${escapeHtml(m.phone||'')}" data-idx="${i}" data-field="phone"></td>
          <td style="padding:var(--sp-sm)"><input class="form-input" style="min-height:32px;font-size:var(--fs-sm);padding:var(--sp-xs) var(--sp-sm)" value="${escapeHtml(m.plan||'')}" data-idx="${i}" data-field="plan"></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <button class="btn btn-primary btn-lg btn-full" id="sr-import" style="margin-top:var(--sp-xl)">${icon('upload',18,'white')} Import ${members.length} Members</button>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  // Update on edit
  el.querySelectorAll('input[data-idx]').forEach(input=>input.addEventListener('input',(e)=>{
    const idx = Number(e.target.dataset.idx); const field = e.target.dataset.field;
    if (members[idx]) members[idx][field] = e.target.value;
  }));
  el.querySelector('#sr-import')?.addEventListener('click',async()=>{
    const btn = el.querySelector('#sr-import'); btn.disabled = true; btn.textContent = 'Importing...';
    const r = await apiRequest('/api/mobile/v1/members/batch',{method:'POST',body:{members}});
    if (r.ok) { showToast(`${r.data?.imported||members.length} members imported!`,'success'); navigate.pop(); navigate.pop(); }
    else { showToast(r.error.message,'error'); btn.disabled = false; btn.textContent = `Import ${members.length} Members`; }
  });
}};
