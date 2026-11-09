import{a as m,x as c,b as u,n as p,e as o,z as b,i as v,f as _,H as g,P as s,t as y,m as f}from"./index-CIkiyrdY.js";const w={async mount(r){await d(r)}};async function d(r){r.innerHTML=`${m({title:"Subscription",showBack:!0})}<div class="scroll-view" id="sub-scroll">${c()}</div>`,u(r,{onBack:()=>p.pop()});const[t,i]=await Promise.all([o("/api/mobile/v1/subscription/status"),o("/api/mobile/v1/members?page=1&page_size=1")]),n=r.querySelector("#sub-scroll");if(!t.ok){n.innerHTML=b(t.error?.message||"Could not load subscription."),n.querySelector("#retry-btn")?.addEventListener("click",()=>d(r));return}const a=t.data||{},l=i.ok?i.data.pagination?.total:null,e={plan_name:a.plan_name||a.plan?.name,status:(a.subscription_status||a.status||"active").toLowerCase(),current_period_end:a.renews_at||a.expires_at,member_limit:a.max_members,members_used:a.members_used??l??null,amount:a.plan?.price?Number(a.plan.price):null};n.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${v("star",28,"var(--brand)")}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${_(e.plan_name||e.plan||"Free")}</h3>
      ${g(e.status||"active")}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${s("Status",e.status||"active")}
      ${e.current_period_end?s("Next Billing",y(e.current_period_end)):""}
      ${e.member_limit?s("Member Limit",String(e.member_limit)):""}
      ${e.members_used!=null?s("Members Used",String(e.members_used)):""}
      ${e.amount?s("Amount",f(e.amount)):""}
    </div></div>
  </div>`}export{w as default};
