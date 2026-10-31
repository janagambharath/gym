import{f as v,a as f,g as d,k as o,i as m,b,n as y,s as u}from"./index-BUgGwFA5.js";const x={async mount(i){const l=await v("/api/member/v1/plans"),n=l.ok?l.data.plans||l.data||[]:[],c=await v("/api/member/v1/payment-info"),r=c.ok?c.data:{};let e=n[0]||null,a="";function p(){i.innerHTML=`${f({title:"Renew Membership",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
      <div style="text-align:center;margin-bottom:var(--sp-xl)">
        <h3>Renew your membership</h3>
        <p style="color:var(--muted);font-size:var(--fs-sm)">Pay via UPI, then tap "I have paid"</p>
      </div>
      ${n.length>1?`<div style="margin-bottom:var(--sp-lg)">
        <label style="font-size:var(--fs-sm);color:var(--muted)">Select plan</label>
        <div style="display:flex;flex-direction:column;gap:var(--sp-sm);margin-top:var(--sp-xs)">
          ${n.map((t,s)=>`<div class="card card-body" style="cursor:pointer;${e?.id===t.id?"border:2px solid var(--brand);":""}" data-plan-idx="${s}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-weight:var(--fw-bold)">${d(t.name)}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${t.duration_days} days</div></div>
              <div style="font-weight:var(--fw-extrabold);color:var(--brand)">${o(t.price)}</div>
            </div>
          </div>`).join("")}
        </div>
      </div>`:""}
      <div class="card card-body" style="margin-top:var(--sp-md)">
        <label style="font-size:var(--fs-sm);color:var(--muted)">Or enter custom amount</label>
        <div style="display:flex;gap:var(--sp-sm);margin-top:var(--sp-xs);align-items:center">
          <span style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">₹</span>
          <input type="number" id="custom-amount" placeholder="Enter amount" min="1"
            style="flex:1;padding:var(--sp-md);border:1px solid var(--border);border-radius:var(--r-md);font-size:var(--fs-lg)"
            value="${a||""}"/>
        </div>
      </div>
      ${e&&!a?`<div class="card card-body" style="text-align:center">
        <div style="font-size:var(--fs-sm);color:var(--muted)">Amount to pay</div>
        <div style="font-size:var(--fs-4xl);font-weight:var(--fw-extrabold);color:var(--brand);margin:var(--sp-sm) 0">${o(a||e.price)}</div>
        <div style="font-size:var(--fs-sm)">${d(e.name)} · ${e.duration_days} days</div>
      </div>`:""}
      ${r.qr_public_url?`<div class="card card-body" style="text-align:center;margin-top:var(--sp-lg)">
        <img src="${d(r.qr_public_url)}" alt="Payment QR" style="max-width:220px;border-radius:var(--r-md)"/>
        ${r.upi_id?`<div style="margin-top:var(--sp-sm);font-size:var(--fs-sm);color:var(--muted)">${d(r.upi_id)}</div>`:""}
        ${r.instructions?`<div style="margin-top:var(--sp-xs);font-size:var(--fs-sm)">${d(r.instructions)}</div>`:""}
      </div>`:'<div class="empty-state"><div class="empty-state-title">QR not configured</div><div class="empty-state-text">Ask your gym for payment details</div></div>'}
      <button class="btn btn-primary btn-block" id="paid-btn" style="margin-top:var(--sp-xl)" ${!e&&!a?"disabled":""}>
        ${m("check",20,"white")} I have paid ${a||e?.price?o(a||e.price):""}
      </button>
    </div></div>`,b(i,{onBack:()=>y.pop()}),i.querySelectorAll("[data-plan-idx]").forEach(t=>t.addEventListener("click",()=>{e=n[parseInt(t.dataset.planIdx)],p()})),i.querySelector("#custom-amount")?.addEventListener("input",t=>{a=t.target.value;const s=i.querySelector("#paid-btn");s&&(s.disabled=!e&&!a,s.innerHTML=`${m("check",20,"white")} I have paid ${a||e?.price?o(a||e.price):""}`)}),i.querySelector("#paid-btn")?.addEventListener("click",async()=>{if(!e&&!a)return;const t=e?{plan_id:e.id}:{};a&&(t.custom_amount=parseFloat(a));const s=await v("/api/member/v1/renew",{method:"POST",body:t});s.ok?(u("Payment notified! Gym will verify soon.","success"),y.pop()):u(s.error?.message||"Failed","error")})}p()}};export{x as default};
