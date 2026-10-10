import{a as n,p as d,b as l,f as o,i as c,g as m,A as u,H as a,I as p,k as v,n as b}from"./index-CekIYfVW.js";const g={async mount(s){s.innerHTML=`${n({title:"Subscription",showBack:!0})}<div class="scroll-view" id="sub-scroll">${d()}</div>`,l(s,{onBack:()=>b.pop()});const r=await o("/api/mobile/v1/subscription/status"),i=s.querySelector("#sub-scroll");if(!r.ok){i.innerHTML='<div class="empty-state"><div class="empty-state-title">Could not load subscription</div></div>';return}const t=r.data||{},e={plan_name:t.plan_name||t.plan?.name,status:(t.subscription_status||t.status||"active").toLowerCase(),current_period_end:t.renews_at||t.expires_at,member_limit:t.max_members,amount:t.plan?.price?Number(t.plan.price):null};i.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${c("star",28,"var(--brand)")}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${m(e.plan_name||e.plan||"Free")}</h3>
      ${u(e.status||"active")}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${a("Status",e.status||"active")}
      ${e.current_period_end?a("Next Billing",p(e.current_period_end)):""}
      ${e.member_limit?a("Member Limit",String(e.member_limit)):""}
      ${e.members_used!=null?a("Members Used",String(e.members_used)):""}
      ${e.amount?a("Amount",v(e.amount)):""}
    </div></div>
  </div>`}};export{g as default};
