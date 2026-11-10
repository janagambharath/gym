import{a as c,x as u,b,n as p,e as d,z as v,i as g,f as y,H as _,T as t,o as f,p as $}from"./index-ClFlXszA.js";const k={async mount(s){await o(s)}};async function o(s){s.innerHTML=`${c({title:"Subscription",showBack:!0})}<div class="scroll-view" id="sub-scroll">${u()}</div>`,b(s,{onBack:()=>p.pop()});const[n,i]=await Promise.all([d("/api/mobile/v1/subscription/status"),d("/api/mobile/v1/members?page=1&page_size=1")]),a=s.querySelector("#sub-scroll");if(!n.ok){a.innerHTML=v(n.error?.message||"Could not load subscription."),a.querySelector("#retry-btn")?.addEventListener("click",()=>o(s));return}const r=n.data||{},l=!i.ok,m=i.ok?i.data.pagination?.total:null,e={plan_name:r.plan_name||r.plan?.name,status:(r.subscription_status||r.status||"active").toLowerCase(),current_period_end:r.renews_at||r.expires_at,member_limit:r.max_members,members_used:r.members_used??m??null,amount:r.plan?.price?Number(r.plan.price):null};a.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body" style="text-align:center">
      <div style="width:56px;height:56px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-md)">${g("star",28,"var(--brand)")}</div>
      <h3 style="margin-bottom:var(--sp-sm)">${y(e.plan_name||"Free")}</h3>
      ${_(e.status||"active")}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      ${t("Status",e.status||"active")}
      ${e.current_period_end?t("Next Billing",f(e.current_period_end)):""}
      ${e.member_limit?t("Member Limit",String(e.member_limit)):""}
      ${e.members_used!=null?t("Members Used",String(e.members_used)):""}
      ${l?'<div style="font-size:var(--fs-sm);color:var(--warning);padding:var(--sp-sm) 0">Could not load member count — <button class="btn btn-sm btn-secondary" id="sub-members-retry">retry</button></div>':""}
      ${e.amount?t("Amount",$(e.amount)):""}
    </div></div>
  </div>`,a.querySelector("#sub-members-retry")?.addEventListener("click",()=>o(s))}export{k as default};
