import{a as w,u as b,b as y,g,k as r,o,K as $,n as L}from"./index-D2dcDZYm.js";const v=[{value:"today",label:"Today",windowLabel:"Today"},{value:"7d",label:"Last 7 days",windowLabel:"Last 7 days"},{value:"30d",label:"Last 30 days",windowLabel:"Last 30 days"}],h={async mount(t){let i="30d";t.innerHTML=`${w({title:"Reports",showBack:!0})}
    <div class="filter-chips" id="rpt-periods" style="padding:var(--sp-sm) var(--sp-lg)">
      ${v.map(a=>`<button class="filter-chip ${a.value===i?"active":""}" data-period="${a.value}">${a.label}</button>`).join("")}
    </div>
    <div class="scroll-view" id="rpt-scroll">${b()}</div>`,y(t,{onBack:()=>L.pop()}),t.querySelector("#rpt-periods").addEventListener("click",a=>{const s=a.target.closest("[data-period]");!s||s.dataset.period===i||(i=s.dataset.period,t.querySelectorAll("#rpt-periods .filter-chip").forEach(e=>e.classList.toggle("active",e===s)),n())});async function n(){const a=t.querySelector("#rpt-scroll"),s=await g(`/api/mobile/v1/reports/summary?period=${i}`);if(!s.ok){a.innerHTML=`<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${s.error.message}</div></div>`;return}const e=s.data,d=v.find(c=>c.value===i)?.windowLabel||"Last 30 days",l=(c,p)=>`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${c}</div>
      ${p.map(([m,u])=>$(m,u)).join("")}</div></div>`;a.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${r(e.members?.active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${r(e.members?.expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${r(e.members?.total||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${r(e.members?.new||0)}</div><div class="metric-card-label">New in ${d}</div></div>
      </div>
    </div>
    ${l("Revenue",[[`Collected (${d.toLowerCase()})`,o(e.revenue?.collected||"0")],["Pending",o(e.revenue?.pending||"0")],["At risk (next 7 days)",o(e.revenue?.at_risk||"0")]])}
    ${e.renewals?l("Renewals",[[`Renewals in ${d}`,r(e.renewals.completed||0)],["Renewal rate (members due in period)",(e.renewals.renewal_rate||"0")+"%"]]):""}
    ${e.whatsapp?l("WhatsApp",[["Messages Sent",r(e.whatsapp.sent||0)],["Failed Messages",r(e.whatsapp.failed||0)]]):""}
  </div>`}await n()}};export{h as default};
