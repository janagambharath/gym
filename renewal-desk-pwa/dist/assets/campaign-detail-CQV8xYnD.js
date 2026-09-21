import{a as p,z as m,b as g,k as $,e as c,D as r,I as t,S as u,u as a,N as l,n as y}from"./index-DBor-WEA.js";const S={async mount(s,o){const v=o?.campaignId;s.innerHTML=`${p({title:"Campaign",showBack:!0})}<div class="scroll-view" id="cd-scroll">${m()}</div>`,g(s,{onBack:()=>y.pop()});const n=await $(`/api/mobile/v1/campaigns/${v}`),d=s.querySelector("#cd-scroll");if(!n.ok){d.innerHTML='<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>';return}const e=n.data;d.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${c(e.name||"Campaign")}</h2>${r(e.status||"sent")}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${t("Segment",u[e.segment]||e.segment||"—")}
      ${t("Recipients",a(e.recipient_count||0))}
      ${t("Sent",a(e.sent_count||0))}
      ${t("Delivered",a(e.delivered_count||0))}
      ${t("Failed",a(e.failed_count||0))}
      ${t("Created",l(e.created_at))}
      ${e.sent_at?t("Sent At",l(e.sent_at)):""}
    </div></div>
    ${e.recipients&&e.recipients.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card">
      ${e.recipients.slice(0,20).map(i=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${c(i.name||i.phone||"")}</div></div>${r(i.status||"sent")}</div>`).join("")}
    </div></div>`:""}
  </div>`}};export{S as default};
