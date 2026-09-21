import{a as i,i as r,e as s,v as l,b as c,k as p,s as d,n as t}from"./index-BPPTfp3n.js";const v={mount(n,o){const a=o||{};n.innerHTML=`${i({title:"Confirm Renewal",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl);text-align:center">
    <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--success-surface);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${r("check",32,"var(--success)")}</div>
    <h2 style="margin-bottom:var(--sp-sm)">Renewal Payment</h2>
    <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);margin-bottom:var(--sp-xxl)">${s(a.memberName||"Member")} — ${l(a.amount||"0")}</p>
    <div class="card card-body" style="text-align:left;margin-bottom:var(--sp-xxl)">
      ${a.planName?`<div class="info-row"><span class="info-row-label">Plan</span><span class="info-row-value">${s(a.planName)}</span></div>`:""}
      ${a.paymentMethod?`<div class="info-row"><span class="info-row-label">Method</span><span class="info-row-value">${s(a.paymentMethod)}</span></div>`:""}
      ${a.membershipEnd?`<div class="info-row"><span class="info-row-label">New Expiry</span><span class="info-row-value">${s(a.membershipEnd)}</span></div>`:""}
    </div>
    <button class="btn btn-success btn-lg btn-full" id="fr-confirm">${r("check",18,"white")} Confirm Renewal</button>
  </div></div>`,c(n,{onBack:()=>t.pop()}),n.querySelector("#fr-confirm")?.addEventListener("click",async()=>{const e=await p(`/api/mobile/v1/payments/${a.paymentId}/verify`,{method:"POST"});d(e.ok?"Renewal confirmed!":e.error.message,e.ok?"success":"error"),e.ok&&t.pop()})}};export{v as default};
