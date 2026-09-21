/* Staff Screen */
import { apiRequest } from '../api.js'; import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderAvatar, renderBadge, renderEmptyState, renderListSkeleton, renderFormField, showToast, showConfirm } from '../components.js';
import { icon } from '../icons.js'; import { escapeHtml } from '../utils.js';
export default { async mount(el) {
  el.innerHTML = `${renderHeader({title:'Staff',showBack:true,actions:[{icon:'add',label:'Add'}]})}<div class="scroll-view" id="staff-list">${renderListSkeleton()}</div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop(), actions:[{onClick:()=>showAddForm()}] });
  const res = await apiRequest('/api/mobile/v1/staff');
  const staff = res.ok ? res.data.staff||res.data||[] : [];
  const list = el.querySelector('#staff-list');
  if (!Array.isArray(staff) || staff.length===0) { list.innerHTML = renderEmptyState({icon:'staff',title:'No staff',text:'Add your team members'}); return; }
  list.innerHTML = `<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${staff.map(s=>`
    <div class="list-item"><div style="display:flex;align-items:center;gap:var(--sp-md);flex:1">
      ${renderAvatar(s.full_name||s.name)}<div class="list-item-content">
        <div class="list-item-title">${escapeHtml(s.full_name||s.name)}</div>
        <div class="list-item-subtitle">${escapeHtml(s.email||'')} · ${escapeHtml(s.role||'')}</div>
      </div></div>${renderBadge(s.is_active!==false?'Active':'Inactive')}</div>`).join('')}</div></div>`;
  function showAddForm(){
    navigate.push('add-member'); // Staff invite uses separate flow in API
  }
}};
