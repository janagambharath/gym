import{a as o,t as m,b as p,g as u,k as s,o as d,J as b,n as w}from"./index-CQxy6hAi.js";const y={async mount(a){a.innerHTML=`${o({title:"Reports",showBack:!0})}<div class="scroll-view" id="rpt-scroll">${m()}</div>`,p(a,{onBack:()=>w.pop()});const r=await u("/api/mobile/v1/reports/summary"),t=a.querySelector("#rpt-scroll");if(!r.ok){t.innerHTML=`<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${r.error.message}</div></div>`;return}const e=r.data,i=(l,c)=>`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${l}</div>
      ${c.map(([v,n])=>b(v,n)).join("")}</div></div>`;t.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${s(e.members?.active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${s(e.members?.expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${s(e.members?.total||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${s(e.members?.new||0)}</div><div class="metric-card-label">New in Selected Period</div></div>
      </div>
    </div>
    ${i("Revenue",[["Collected (selected period)",d(e.revenue?.collected||"0")],["Pending",d(e.revenue?.pending||"0")],["At risk (next 7 days)",d(e.revenue?.at_risk||"0")]])}
    ${e.renewals?i("Renewals",[["Renewals in Selected Period",s(e.renewals.completed||0)],["Renewal rate (members due in period)",(e.renewals.renewal_rate||"0")+"%"]]):""}
    ${e.whatsapp?i("WhatsApp",[["Messages Sent",s(e.whatsapp.sent||0)],["Failed Messages",s(e.whatsapp.failed||0)]]):""}
  </div>`}};export{y as default};
