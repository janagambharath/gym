import{e as d,a as m,b as y,j as l,z as u,G as t,H as b,D as h,f as $,i as c,s as r,n,B as f}from"./index-3tbZ5J4-.js";const w={async mount(a,v){const i=v?.paymentId,p=await d(`/api/mobile/v1/payments/${i}`);if(!p.ok){a.innerHTML=`${m({title:"Payment",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Payment not found</div></div>`,y(a,{onBack:()=>n.pop()});return}const e=p.data;a.innerHTML=`${m({title:"Payment Detail",showBack:!0})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="text-align:center;padding:var(--sp-xxl);background:var(--card);border-bottom:1px solid var(--border-light)">
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold);margin-bottom:var(--sp-sm)">${l(e.amount)}</div>
        ${u(e.status)}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        ${t("Member",e.member_name||"—")}
        ${t("Plan",e.plan_name||"—")}
        ${e.standard_price?t("Standard Price",l(e.standard_price)):""}
        ${e.discount&&e.discount!=="0"&&e.discount!=="0.00"?t("Discount",l(e.discount)):""}
        ${t("Method",e.method)}
        ${e.channel?t("Channel",e.channel):""}
        ${t("Reference",e.reference||"—")}
        ${t("Date",b(e.paid_on||e.created_at))}
        ${e.notes?t("Notes",e.notes):""}
        ${e.created_by?t("Created By",e.created_by):""}
        ${e.verified_by?t("Verified By",e.verified_by):""}
        ${e.verified_at?t("Verified At",h(e.verified_at)):""}
      </div></div>
      <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
        ${e.whatsapp_url||e.receipt?.whatsapp_url?`<a href="${$(e.whatsapp_url||e.receipt?.whatsapp_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-full" id="pd-share-receipt" style="background:#25D366;border-color:#25D366;color:#ffffff;display:flex;align-items:center;justify-content:center;gap:var(--sp-xs);text-decoration:none">${c("share",18,"white")} Share WhatsApp Receipt</a>`:""}
        ${e.status==="pending"?`<button class="btn btn-success btn-full" id="pd-verify">${c("check",18,"white")} Verify Payment</button>
        <button class="btn btn-danger btn-full" id="pd-reject">${c("close",18,"white")} Reject Payment</button>`:""}
        <button class="btn btn-secondary btn-full btn-sm" id="pd-delete" style="margin-top:var(--sp-md)">${c("delete",16)} Delete Payment</button>
      </div>
    </div></div>`,y(a,{onBack:()=>n.pop()}),a.querySelector("#pd-verify")?.addEventListener("click",async()=>{const o=await d(`/api/mobile/v1/payments/${i}/verify`,{method:"POST"});o.ok?(r("Payment verified!","success"),n.pop()):r(o.error.message,"error")}),a.querySelector("#pd-reject")?.addEventListener("click",async()=>{if(!await f({title:"Reject Payment",message:"This will reject the payment.",confirmText:"Reject",destructive:!0}))return;const s=await d(`/api/mobile/v1/payments/${i}/reject`,{method:"POST"});s.ok?(r("Payment rejected","success"),n.pop()):r(s.error.message,"error")}),a.querySelector("#pd-delete")?.addEventListener("click",async()=>{if(!await f({title:"Delete Payment",message:"This cannot be undone.",confirmText:"Delete",destructive:!0}))return;const s=await d(`/api/mobile/v1/payments/${i}`,{method:"DELETE"});s.ok?(r("Payment deleted","success"),n.pop()):r(s.error.message,"error")})}};export{w as default};
