import{a as o,u as m,b as c,g as d,i as u,j as p,E as v,K as a,t as b,o as _,n as g}from"./index-B1po66HU.js";const $={async mount(t){t.innerHTML=`${o({title:"Subscription",showBack:!0})}<div class="scroll-view" id="sub-scroll">${m()}</div>`,c(t,{onBack:()=>g.pop()});const[r,i]=await Promise.all([d("/api/mobile/v1/subscription/status"),d("/api/mobile/v1/members?page=1&page_size=1")]),n=t.querySelector("#sub-scroll");if(!r.ok){n.innerHTML='<div class="empty-state"><div class="empty-state-title">Could not load subscription</div></div>';return}const s=r.data||{},l=i.ok?i.data.pagination?.total:null,e={plan_name:s.plan_name||s.plan?.name,status:(s.subscription_status||s.status||"active").toLowerCase(),current_period_end:s.renews_at||s.expires_at,member_limit:s.max_members,members_used:s.members_used??l??null,amount:s.plan?.price?Number(s.plan.price):null};n.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${u("star",28,"var(--brand)")}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${p(e.plan_name||e.plan||"Free")}</h3>
      ${v(e.status||"active")}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${a("Status",e.status||"active")}
      ${e.current_period_end?a("Next Billing",b(e.current_period_end)):""}
      ${e.member_limit?a("Member Limit",String(e.member_limit)):""}
      ${e.members_used!=null?a("Members Used",String(e.members_used)):""}
      ${e.amount?a("Amount",_(e.amount)):""}
    </div></div>
  </div>`}};export{$ as default};
