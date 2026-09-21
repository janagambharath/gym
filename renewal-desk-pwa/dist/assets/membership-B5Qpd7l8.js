import{a as o,z as d,b as l,k as c,F as s,w as r,e as m,t as p,n as v}from"./index-BcPSQxV-.js";const g={async mount(t){t.innerHTML=`${o({title:"Membership",showBack:!0})}<div class="scroll-view" id="mm-scroll">${d()}</div>`,l(t,{onBack:()=>v.pop()});const n=await c("/api/member/v1/membership"),i=t.querySelector("#mm-scroll"),a=n.ok?n.data:{};i.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Current Plan</h3>
      ${s("Plan",a.plan_name||"—")}
      ${s("Status",a.status||"—")}
      ${s("Start Date",r(a.start_date))}
      ${s("End Date",r(a.end_date))}
      ${a.days_remaining!=null?s("Days Left",String(a.days_remaining)):""}
    </div></div>
    ${a.history&&a.history.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Renewal History</h3>
      ${a.history.map(e=>`<div class="info-row"><span class="info-row-label">${r(e.renewed_on||e.start_date)}</span><span class="info-row-value">${m(e.plan_name||"—")} — ${p(e.amount||"0")}</span></div>`).join("")}
    </div></div>`:""}
  </div>`}};export{g as default};
