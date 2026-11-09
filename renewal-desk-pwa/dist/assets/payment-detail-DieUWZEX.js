import{e as c,a as y,z as h,b as f,n as i,m,H as $,S as a,t as g,w,f as k,i as l,s as n,u as v}from"./index-Dt9-M7Kn.js";const P={async mount(t,b){const d=b?.paymentId;async function u(){const o=await c(`/api/mobile/v1/payments/${d}`);if(!o.ok){o.error?.status===404?t.innerHTML=`${y({title:"Payment",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Payment not found</div></div>`:(t.innerHTML=`${y({title:"Payment",showBack:!0})}<div class="scroll-view">${h(o.error?.message||"Failed to load")}</div>`,t.querySelector("#retry-btn")?.addEventListener("click",u)),f(t,{onBack:()=>i.pop()});return}const e=o.data;t.innerHTML=`${y({title:"Payment Detail",showBack:!0})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="text-align:center;padding:var(--sp-xxl);background:var(--card);border-bottom:1px solid var(--border-light)">
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold);margin-bottom:var(--sp-sm)">${m(e.amount)}</div>
        ${$(e.status)}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        ${a("Member",e.member_name||"—")}
        ${a("Plan",e.plan_name||"—")}
        ${e.standard_price?a("Standard Price",m(e.standard_price)):""}
        ${e.discount&&e.discount!=="0"&&e.discount!=="0.00"?a("Discount",m(e.discount)):""}
        ${a("Method",e.method)}
        ${e.channel?a("Channel",e.channel):""}
        ${a("Reference",e.reference||"—")}
        ${a("Date",g(e.paid_on||e.created_at))}
        ${e.notes?a("Notes",e.notes):""}
        ${e.created_by?a("Created By",e.created_by):""}
        ${e.verified_by?a("Verified By",e.verified_by):""}
        ${e.verified_at?a("Verified At",w(e.verified_at)):""}
      </div></div>
      <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
        ${e.whatsapp_url||e.receipt?.whatsapp_url?`<a href="${k(e.whatsapp_url||e.receipt?.whatsapp_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-full" id="pd-share-receipt" style="background:#25D366;border-color:#25D366;color:#ffffff;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);text-decoration:none">${l("share",18,"white")} Share WhatsApp Receipt</a>`:""}
        ${e.status==="pending"?`<button class="btn btn-success btn-full" id="pd-verify">${l("check",18,"white")} Verify Payment</button>
        <button class="btn btn-danger btn-full" id="pd-reject">${l("close",18,"white")} Reject Payment</button>`:""}
        <button class="btn btn-secondary btn-full btn-sm" id="pd-delete" style="margin-top:var(--sp-md)">${l("delete",16)} Delete Payment</button>
      </div>
    </div></div>`,f(t,{onBack:()=>i.pop()});const p=(r,s)=>async()=>{if(!r.disabled){r.disabled=!0;try{await s()}finally{r.disabled=!1}}};t.querySelector("#pd-verify")?.addEventListener("click",p(t.querySelector("#pd-verify"),async()=>{const r=await c(`/api/mobile/v1/payments/${d}/verify`,{method:"POST"});r.ok?(n("Payment verified!","success"),i.pop()):n(r.error.message,"error")})),t.querySelector("#pd-reject")?.addEventListener("click",p(t.querySelector("#pd-reject"),async()=>{if(!await v({title:"Reject Payment",message:"This will reject the payment.",confirmText:"Reject",destructive:!0}))return;const s=await c(`/api/mobile/v1/payments/${d}/reject`,{method:"POST"});s.ok?(n("Payment rejected","success"),i.pop()):n(s.error.message,"error")})),t.querySelector("#pd-delete")?.addEventListener("click",p(t.querySelector("#pd-delete"),async()=>{if(!await v({title:"Delete Payment",message:"This cannot be undone.",confirmText:"Delete",destructive:!0}))return;const s=await c(`/api/mobile/v1/payments/${d}`,{method:"DELETE"});s.ok?(n("Payment deleted","success"),i.pop()):n(s.error.message,"error")}))}await u()}};export{P as default};
