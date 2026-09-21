/* Import Members Screen */
import { navigate } from '../app.js';
import { renderHeader, bindHeaderEvents, renderMenuItem } from '../components.js';
import { icon } from '../icons.js';
export default { mount(el) {
  el.innerHTML = `${renderHeader({title:'Import Members',showBack:true})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <h3 style="margin-bottom:var(--sp-lg)">Choose import method</h3>
    <div class="card">
      ${renderMenuItem({iconName:'upload',label:'Upload CSV',desc:'Import from a spreadsheet file',onClick:'member-import',iconBg:'var(--brand-subtle)',iconColor:'var(--brand)'})}
      ${renderMenuItem({iconName:'camera',label:'Scan Document',desc:'Scan a physical register page',onClick:'member-scan',iconBg:'var(--success-surface)',iconColor:'var(--success)'})}
      ${renderMenuItem({iconName:'add',label:'Add Manually',desc:'Enter members one by one',onClick:'add-member',iconBg:'var(--info-surface)',iconColor:'var(--info)'})}
    </div>
  </div></div>`;
  bindHeaderEvents(el, { onBack:()=>navigate.pop() });
  el.querySelectorAll('[data-action]').forEach(i=>i.addEventListener('click',()=>navigate.push(i.dataset.action)));
}};
