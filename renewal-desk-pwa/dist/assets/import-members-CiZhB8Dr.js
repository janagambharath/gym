import{a as n,G as a,b as s,n as r}from"./index-BcPSQxV-.js";const i={mount(e){e.innerHTML=`${n({title:"Import Members",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <h3 style="margin-bottom:var(--sp-lg)">Choose import method</h3>
    <div class="card">
      ${a({iconName:"upload",label:"Upload CSV",desc:"Import from a spreadsheet file",onClick:"member-import",iconBg:"var(--brand-subtle)",iconColor:"var(--brand)"})}
      ${a({iconName:"camera",label:"Scan Document",desc:"Scan a physical register page",onClick:"member-scan",iconBg:"var(--success-surface)",iconColor:"var(--success)"})}
      ${a({iconName:"add",label:"Add Manually",desc:"Enter members one by one",onClick:"add-member",iconBg:"var(--info-surface)",iconColor:"var(--info)"})}
    </div>
  </div></div>`,s(e,{onBack:()=>r.pop()}),e.querySelectorAll("[data-action]").forEach(o=>o.addEventListener("click",()=>r.push(o.dataset.action)))}};export{i as default};
