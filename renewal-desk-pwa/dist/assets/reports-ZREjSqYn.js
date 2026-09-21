import{a as n,z as m,b as p,k as y,u as a,v as i,I as u,n as w}from"./index-BNW__y8c.js";const b={async mount(s){s.innerHTML=`${n({title:"Reports",showBack:!0})}<div class="scroll-view" id="rpt-scroll">${m()}</div>`,p(s,{onBack:()=>w.pop()});const r=await y("/api/mobile/v1/reports/summary"),d=s.querySelector("#rpt-scroll");if(!r.ok){d.innerHTML=`<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${r.error.message}</div></div>`;return}const e=r.data,t=(c,l)=>`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${c}</div>
      ${l.map(([v,o])=>u(v,o)).join("")}</div></div>`;d.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${a(e.total_active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${a(e.total_expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${a(e.total_members||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${a(e.new_members_this_month||0)}</div><div class="metric-card-label">New This Month</div></div>
      </div>
    </div>
    ${t("Revenue",[["Today",i(e.revenue_today||"0")],["This Week",i(e.revenue_week||"0")],["This Month",i(e.revenue_month||"0")]])}
    ${e.renewals?t("Renewals",[["Renewed This Month",a(e.renewals.renewed_this_month||0)],["Recovery Rate",(e.renewals.recovery_rate||"0")+"%"]]):""}
    ${e.whatsapp?t("WhatsApp",[["Messages Sent Today",a(e.whatsapp.sent_today||0)],["Total Sent",a(e.whatsapp.total_sent||0)]]):""}
  </div>`}};export{b as default};
