import{a as m,u as g,b as u,g as $,j as c,E as d,K as n,T as h,k as s,H as l,n as y}from"./index-B1po66HU.js";const f={async mount(t,v){const p=v?.campaignId;t.innerHTML=`${m({title:"Campaign",showBack:!0})}<div class="scroll-view" id="cd-scroll">${g()}</div>`,u(t,{onBack:()=>y.pop()});const r=await $(`/api/mobile/v1/campaigns/${p}`),o=t.querySelector("#cd-scroll");if(!r.ok){o.innerHTML='<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>';return}const e=r.data;o.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${c(e.name||"Campaign")}</h2>${d(e.status||"sent")}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${n("Segment",h[e.segment]||e.segment||"—")}
      ${n("Recipients",s(e.recipient_count||0))}
      ${n("Sent",s(e.sent_count||0))}
      ${n("Delivered",s(e.delivered_count||0))}
      ${n("Failed",s(e.failed_count||0))}
      ${n("Created",l(e.created_at))}
      ${e.sent_at?n("Sent At",l(e.sent_at)):""}
    </div></div>
    ${e.recipients&&e.recipients.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)" id="cd-recip-note">Showing ${Math.min(20,e.recipients.length)} of ${s(e.recipient_count||e.recipients.length)} recipients</div>
      <div class="card" id="cd-recips">
      ${e.recipients.slice(0,20).map(i=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${c(i.name||i.phone||"")}</div></div>${d(i.status||"sent")}</div>`).join("")}
      </div>
      ${e.recipients.length>20?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="cd-more">Show more</button></div>':""}
    </div>`:""}
  </div>`;let a=20;t.querySelector("#cd-more")?.addEventListener("click",()=>{a=Math.min(e.recipients.length,a+20),t.querySelector("#cd-recips").innerHTML=e.recipients.slice(0,a).map(i=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${c(i.name||i.phone||"")}</div></div>${d(i.status||"sent")}</div>`).join(""),t.querySelector("#cd-recip-note").textContent=`Showing ${a} of ${s(e.recipient_count||e.recipients.length)} recipients`,a>=e.recipients.length&&t.querySelector("#cd-more")?.remove()})}};export{f as default};
