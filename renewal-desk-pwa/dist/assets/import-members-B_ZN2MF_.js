import{a as c,A as a,b as n,n as r}from"./index-3tbZ5J4-.js";const t={mount(e){e.innerHTML=`${c({title:"Import Members",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <h3 style="margin-bottom:var(--sp-lg)">Choose import method</h3>
    <div class="card">
      ${a({iconName:"upload",label:"Upload CSV",desc:"Import from a spreadsheet file",onClick:"member-import",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
      ${a({iconName:"camera",label:"Scan Document",desc:"Scan a physical register page",onClick:"member-scan",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
      ${a({iconName:"add",label:"Add Manually",desc:"Enter members one by one",onClick:"add-member",iconBg:"var(--info-surface)",iconColor:"var(--info)"})}
    </div>
  </div></div>`,n(e,{onBack:()=>r.pop()}),e.querySelectorAll("[data-action]").forEach(o=>o.addEventListener("click",()=>r.push(o.dataset.action)))}};export{t as default};
