import{f as o,a as y,b as f,k as p,A as b,H as t,I as h,E as g,g as $,i as c,n as i,s as n,C as u}from"./index-Bvpm40oj.js";const _={async mount(a,v){const d=v?.paymentId,m=await o(`/api/mobile/v1/payments/${d}`);if(!m.ok){a.innerHTML=`${y({title:"Payment",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Payment not found</div></div>`,f(a,{onBack:()=>i.pop()});return}const e=m.data;a.innerHTML=`${y({title:"Payment Detail",showBack:!0})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="text-align:center;padding:var(--sp-xxl);background:var(--card);border-bottom:1px solid var(--border-light)">
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold);margin-bottom:var(--sp-sm)">${p(e.amount)}</div>
        ${b(e.status)}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        ${t("Member",e.member_name||"—")}
        ${t("Plan",e.plan_name||"—")}
        ${e.standard_price?t("Standard Price",p(e.standard_price)):""}
        ${e.discount&&e.discount!=="0"&&e.discount!=="0.00"?t("Discount",p(e.discount)):""}
        ${t("Method",e.method)}
        ${e.channel?t("Channel",e.channel):""}
        ${t("Reference",e.reference||"—")}
        ${t("Date",h(e.paid_on||e.created_at))}
        ${e.notes?t("Notes",e.notes):""}
        ${e.created_by?t("Created By",e.created_by):""}
        ${e.verified_by?t("Verified By",e.verified_by):""}
        ${e.verified_at?t("Verified At",g(e.verified_at)):""}
      </div></div>
      <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
        ${e.whatsapp_url||e.receipt?.whatsapp_url?`<a href="${$(e.whatsapp_url||e.receipt?.whatsapp_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-full" id="pd-share-receipt" style="background:#25D366;border-color:#25D366;color:#ffffff;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);text-decoration:none">${c("share",18,"white")} Share WhatsApp Receipt</a>`:""}
        ${e.status==="pending"?`<button class="btn btn-success btn-full" id="pd-verify">${c("check",18,"white")} Verify Payment</button>
        <button class="btn btn-danger btn-full" id="pd-reject">${c("close",18,"white")} Reject Payment</button>`:""}
        <button class="btn btn-secondary btn-full btn-sm" id="pd-delete" style="margin-top:var(--sp-md)">${c("delete",16)} Delete Payment</button>
      </div>
    </div></div>`,f(a,{onBack:()=>i.pop()});const l=(r,s)=>async()=>{if(!r.disabled){r.disabled=!0;try{await s()}finally{r.disabled=!1}}};a.querySelector("#pd-verify")?.addEventListener("click",l(a.querySelector("#pd-verify"),async()=>{const r=await o(`/api/mobile/v1/payments/${d}/verify`,{method:"POST"});r.ok?(n("Payment verified!","success"),i.pop()):n(r.error.message,"error")})),a.querySelector("#pd-reject")?.addEventListener("click",l(a.querySelector("#pd-reject"),async()=>{if(!await u({title:"Reject Payment",message:"This will reject the payment.",confirmText:"Reject",destructive:!0}))return;const s=await o(`/api/mobile/v1/payments/${d}/reject`,{method:"POST"});s.ok?(n("Payment rejected","success"),i.pop()):n(s.error.message,"error")})),a.querySelector("#pd-delete")?.addEventListener("click",l(a.querySelector("#pd-delete"),async()=>{if(!await u({title:"Delete Payment",message:"This cannot be undone.",confirmText:"Delete",destructive:!0}))return;const s=await o(`/api/mobile/v1/payments/${d}`,{method:"DELETE"});s.ok?(n("Payment deleted","success"),i.pop()):n(s.error.message,"error")}))}};export{_ as default};
