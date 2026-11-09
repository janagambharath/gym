import{a as u,x as v,b as $,e as y,z as h,f as d,H as o,P as n,X as f,k as a,w as p,n as S}from"./index-CIkiyrdY.js";const L={async mount(t,m){const g=m?.campaignId;t.innerHTML=`${u({title:"Campaign",showBack:!0})}<div class="scroll-view" id="cd-scroll">${v()}</div>`,$(t,{onBack:()=>S.pop()});async function l(){const s=t.querySelector("#cd-scroll");s&&(s.innerHTML=v());const c=await y(`/api/mobile/v1/campaigns/${g}`);if(!c.ok){c.error?.status===404?s.innerHTML='<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>':(s.innerHTML=h(c.error?.message||"Failed to load"),s.querySelector("#retry-btn")?.addEventListener("click",l));return}const e=c.data;s.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${d(e.name||"Campaign")}</h2>${o(e.status||"sent")}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${n("Segment",f[e.segment]||e.segment||"—")}
      ${n("Recipients",a(e.recipient_count||0))}
      ${n("Sent",a(e.sent_count||0))}
      ${n("Delivered",a(e.delivered_count||0))}
      ${n("Failed",a(e.failed_count||0))}
      ${n("Created",p(e.created_at))}
      ${e.sent_at?n("Sent At",p(e.sent_at)):""}
    </div></div>
    ${e.recipients&&e.recipients.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)">
      <div style="font-size:var(--fs-sm);color:var(--muted);margin-bottom:var(--sp-sm)" id="cd-recip-note">Showing ${Math.min(20,e.recipients.length)} of ${a(e.recipient_count||e.recipients.length)} recipients</div>
      <div class="card" id="cd-recips">
      ${e.recipients.slice(0,20).map(i=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${d(i.name||i.phone||"")}</div></div>${o(i.status||"sent")}</div>`).join("")}
      </div>
      ${e.recipients.length>20?'<div style="text-align:center;padding:var(--sp-md)"><button class="btn btn-secondary" id="cd-more">Show more</button></div>':""}
    </div>`:""}
  </div>`;let r=20;t.querySelector("#cd-more")?.addEventListener("click",()=>{r=Math.min(e.recipients.length,r+20),t.querySelector("#cd-recips").innerHTML=e.recipients.slice(0,r).map(i=>`<div class="list-item"><div class="list-item-content"><div class="list-item-title">${d(i.name||i.phone||"")}</div></div>${o(i.status||"sent")}</div>`).join(""),t.querySelector("#cd-recip-note").textContent=`Showing ${r} of ${a(e.recipient_count||e.recipients.length)} recipients`,r>=e.recipients.length&&t.querySelector("#cd-more")?.remove()})}await l()}};export{L as default};
