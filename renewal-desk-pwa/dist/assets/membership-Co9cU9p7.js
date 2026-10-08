import{a as o,o as d,b as l,e as c,F as s,G as t,f as m,j as p,n as v}from"./index-DBAqsMek.js";const g={async mount(r){r.innerHTML=`${o({title:"Membership",showBack:!0})}<div class="scroll-view" id="mm-scroll">${d()}</div>`,l(r,{onBack:()=>v.pop()});const n=await c("/api/member/v1/membership"),i=r.querySelector("#mm-scroll"),a=n.ok?n.data:{};i.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Current Plan</h3>
      ${s("Plan",a.plan_name||"—")}
      ${s("Status",a.status||"—")}
      ${s("Start Date",t(a.start_date))}
      ${s("End Date",t(a.end_date))}
      ${a.days_remaining!=null?s("Days Left",String(a.days_remaining)):""}
    </div></div>
    ${a.history&&a.history.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <h3 style="margin-bottom:var(--sp-lg)">Renewal History</h3>
      ${a.history.map(e=>`<div class="info-row"><span class="info-row-label">${t(e.renewed_on||e.start_date)}</span><span class="info-row-value">${m(e.plan_name||"—")} — ${p(e.amount||"0")}</span></div>`).join("")}
    </div></div>`:""}
  </div>`}};export{g as default};
