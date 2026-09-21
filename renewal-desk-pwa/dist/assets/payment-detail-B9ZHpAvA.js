import{k as o,a as p,b as y,v as c,C as f,I as t,J as b,N as $,i as l,s,n as r,E as v}from"./index-BPPTfp3n.js";const h={async mount(a,u){const i=u?.paymentId,m=await o(`/api/mobile/v1/payments/${i}`);if(!m.ok){a.innerHTML=`${p({title:"Payment",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Payment not found</div></div>`,y(a,{onBack:()=>r.pop()});return}const e=m.data;a.innerHTML=`${p({title:"Payment Detail",showBack:!0})}
    <div class="scroll-view"><div class="scroll-content">
      <div style="text-align:center;padding:var(--sp-xxl);background:var(--card);border-bottom:1px solid var(--border-light)">
        <div style="font-size:var(--fs-6xl);font-weight:var(--fw-extrabold);margin-bottom:var(--sp-sm)">${c(e.amount)}</div>
        ${f(e.status)}
      </div>
      <div style="padding:var(--sp-lg)"><div class="card card-body">
        ${t("Member",e.member_name||"—")}
        ${t("Plan",e.plan_name||"—")}
        ${e.standard_price?t("Standard Price",c(e.standard_price)):""}
        ${e.discount&&e.discount!=="0"&&e.discount!=="0.00"?t("Discount",c(e.discount)):""}
        ${t("Method",e.method)}
        ${e.channel?t("Channel",e.channel):""}
        ${t("Reference",e.reference||"—")}
        ${t("Date",b(e.paid_on||e.created_at))}
        ${e.notes?t("Notes",e.notes):""}
        ${e.created_by?t("Created By",e.created_by):""}
        ${e.verified_by?t("Verified By",e.verified_by):""}
        ${e.verified_at?t("Verified At",$(e.verified_at)):""}
      </div></div>
      <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
        ${e.status==="pending"?`<button class="btn btn-success btn-full" id="pd-verify">${l("check",18,"white")} Verify Payment</button>
        <button class="btn btn-danger btn-full" id="pd-reject">${l("close",18,"white")} Reject Payment</button>`:""}
        <button class="btn btn-secondary btn-full btn-sm" id="pd-delete" style="margin-top:var(--sp-md)">${l("delete",16)} Delete Payment</button>
      </div>
    </div></div>`,y(a,{onBack:()=>r.pop()}),a.querySelector("#pd-verify")?.addEventListener("click",async()=>{const d=await o(`/api/mobile/v1/payments/${i}/verify`,{method:"POST"});d.ok?(s("Payment verified!","success"),r.pop()):s(d.error.message,"error")}),a.querySelector("#pd-reject")?.addEventListener("click",async()=>{if(!await v({title:"Reject Payment",message:"This will reject the payment.",confirmText:"Reject",destructive:!0}))return;const n=await o(`/api/mobile/v1/payments/${i}/reject`,{method:"POST"});n.ok?(s("Payment rejected","success"),r.pop()):s(n.error.message,"error")}),a.querySelector("#pd-delete")?.addEventListener("click",async()=>{if(!await v({title:"Delete Payment",message:"This cannot be undone.",confirmText:"Delete",destructive:!0}))return;const n=await o(`/api/mobile/v1/payments/${i}`,{method:"DELETE"});n.ok?(s("Payment deleted","success"),r.pop()):s(n.error.message,"error")})}};export{h as default};
