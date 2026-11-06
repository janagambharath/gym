import{a as b,u as y,b as w,g,k as r,o as n,K as $,n as L}from"./index-BZNT0j-X.js";const v=[{value:"today",label:"Today",windowLabel:"Today"},{value:"7d",label:"Last 7 days",windowLabel:"Last 7 days"},{value:"30d",label:"Last 30 days",windowLabel:"Last 30 days"}],h={async mount(t){let i="30d";t.innerHTML=`${b({title:"Reports",showBack:!0})}
    <div class="filter-chips" id="rpt-periods" style="padding:var(--sp-sm) var(--sp-lg)">
      ${v.map(a=>`<button class="filter-chip ${a.value===i?"active":""}" data-period="${a.value}">${a.label}</button>`).join("")}
    </div>
    <div class="scroll-view" id="rpt-scroll">${y()}</div>`,w(t,{onBack:()=>L.pop()}),t.querySelector("#rpt-periods").addEventListener("click",a=>{const s=a.target.closest("[data-period]");!s||s.dataset.period===i||(i=s.dataset.period,t.querySelectorAll("#rpt-periods .filter-chip").forEach(e=>e.classList.toggle("active",e===s)),d())});async function d(){const a=t.querySelector("#rpt-scroll"),s=await g(`/api/mobile/v1/reports/summary?period=${i}`);if(!s.ok){a.innerHTML=`<div class="empty-state"><div class="empty-state-title">Could not load reports</div><div class="empty-state-text">${s.error.message}</div><button class="btn btn-primary" id="rpt-retry" style="margin-top:var(--sp-md)">Try Again</button></div>`,a.querySelector("#rpt-retry")?.addEventListener("click",d);return}const e=s.data,l=v.find(o=>o.value===i)?.windowLabel||"Last 30 days",c=(o,p)=>`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
    <div class="card card-body"><div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${o}</div>
      ${p.map(([m,u])=>$(m,u)).join("")}</div></div>`;a.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)">
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-card-value" style="color:var(--success)">${r(e.members?.active||0)}</div><div class="metric-card-label">Active Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--warning)">${r(e.members?.expired||0)}</div><div class="metric-card-label">Expired Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--brand)">${r(e.members?.total||0)}</div><div class="metric-card-label">Total Members</div></div>
        <div class="metric-card"><div class="metric-card-value" style="color:var(--status-pending)">${r(e.members?.new||0)}</div><div class="metric-card-label">New in ${l}</div></div>
      </div>
    </div>
    ${c("Revenue",[[`Collected (${l.toLowerCase()})`,n(e.revenue?.collected||"0")],["Pending",n(e.revenue?.pending||"0")],["At risk (next 7 days)",n(e.revenue?.at_risk||"0")]])}
    ${e.renewals?c("Renewals",[[`Renewals in ${l}`,r(e.renewals.completed||0)],["Renewal rate (members due in period)",(e.renewals.renewal_rate||"0")+"%"]]):""}
    ${e.whatsapp?c("WhatsApp",[["Messages Sent",r(e.whatsapp.sent||0)],["Failed Messages",r(e.whatsapp.failed||0)]]):""}
  </div>`}await d()}};export{h as default};
