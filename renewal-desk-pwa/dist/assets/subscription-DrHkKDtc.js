import{a as i,z as n,b as d,k as l,i as o,e as c,D as v,I as s,J as m,v as u,n as p}from"./index-BNW__y8c.js";const g={async mount(t){t.innerHTML=`${i({title:"Subscription",showBack:!0})}<div class="scroll-view" id="sub-scroll">${n()}</div>`,d(t,{onBack:()=>p.pop()});const a=await l("/api/mobile/v1/billing"),r=t.querySelector("#sub-scroll");if(!a.ok){r.innerHTML='<div class="empty-state"><div class="empty-state-title">Could not load subscription</div></div>';return}const e=a.data;r.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${o("star",28,"var(--brand)")}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${c(e.plan_name||e.plan||"Free")}</h3>
      ${v(e.status||"active")}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${s("Status",e.status||"active")}
      ${e.current_period_end?s("Next Billing",m(e.current_period_end)):""}
      ${e.member_limit?s("Member Limit",String(e.member_limit)):""}
      ${e.members_used!=null?s("Members Used",String(e.members_used)):""}
      ${e.amount?s("Amount",u(e.amount)):""}
    </div></div>
  </div>`}};export{g as default};
