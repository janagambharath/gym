import{a as y,x as v,b as S,e as g,z as _,f as C,H as w,T as t,a1 as h,k as a,p as L,m as u,s as f,n as T}from"./index-Cn_Ntmv6.js";const H={async mount(r,$){const o=$?.campaignId;r.innerHTML=`${y({title:"Campaign",showBack:!0})}<div class="scroll-view" id="cd-scroll">${v()}</div>`,S(r,{onBack:()=>T.pop()});async function l(){const s=r.querySelector("#cd-scroll");s&&(s.innerHTML=v());const i=await g(`/api/mobile/v1/campaigns/${o}`);if(!i.ok){i.error?.status===404?s.innerHTML='<div class="empty-state"><div class="empty-state-title">Campaign not found</div></div>':(s.innerHTML=_(i.error?.message||"Failed to load"),s.querySelector("#retry-btn")?.addEventListener("click",l));return}const e=i.data,b=e.status==="draft"||e.status==="failed";s.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)"><h2 style="margin-bottom:var(--sp-sm)">${C(e.name||"Campaign")}</h2>${w(e.status||"sent")}</div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${t("Segment",h[e.segment_type]||e.segment_type||"—")}
      ${t("Recipients",a(e.total_recipients??0))}
      ${t("Sent",a(e.total_sent??0))}
      ${t("Delivered",a(e.total_delivered??0))}
      ${t("Read",a(e.total_read??0))}
      ${t("Replied",a(e.total_replied??0))}
      ${t("Renewals attributed",a(e.total_renewed??0))}
      ${t("Revenue recovered",L(e.total_revenue_recovered??"0"))}
      ${t("Created",u(e.created_at))}
      ${e.sent_at?t("Sent At",u(e.sent_at)):""}
      ${e.error_message?t("Error",e.error_message):""}
    </div></div>
    ${b?'<div style="padding:0 var(--sp-lg) var(--sp-lg)"><button class="btn btn-whatsapp btn-lg btn-full" id="cd-send">Send Campaign</button></div>':""}
  </div>`,r.querySelector("#cd-send")?.addEventListener("click",async()=>{const n=r.querySelector("#cd-send");n&&(n.disabled=!0,n.textContent="Sending…");const d=await g(`/api/mobile/v1/campaigns/${o}/send`,{method:"POST",timeoutMs:12e4,headers:{"Idempotency-Key":`campaign-send-${o}`}});if(d.ok){const c=d.data?.sent,m=d.data?.total,p=d.data?.failed;f(typeof c=="number"&&typeof m=="number"?`Campaign launched! Sent to ${a(c)} of ${a(m)} members${p>0?` (${a(p)} failed)`:""}.`:"Campaign launched!","success"),await l()}else f(d.error?.message||"Could not send this campaign.","error"),n&&(n.disabled=!1,n.textContent="Send Campaign")})}await l()}};export{H as default};
