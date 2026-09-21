import{k as r,a as v,i as c,e as n,v as p,b as m,s as d,n as l}from"./index-ivBBLkG7.js";const f={async mount(a){const t=await r("/api/member/v1/plans"),s=t.ok?t.data.plans||t.data||[]:[];a.innerHTML=`${v({title:"Renew Membership",showBack:!0})}<div class="scroll-view"><div class="scroll-content" style="padding:var(--sp-xxl)">
    <div style="text-align:center;margin-bottom:var(--sp-xxl)">
      <div style="width:64px;height:64px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center;margin:0 auto var(--sp-lg)">${c("renewals",32,"var(--brand)")}</div>
      <h3>Select a plan to renew</h3>
    </div>
    <div style="display:flex;flex-direction:column;gap:var(--sp-md)">
      ${s.map(e=>`<div class="card card-body" style="cursor:pointer;transition:all 0.15s" data-plan='${n(JSON.stringify(e))}'>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:var(--fw-bold)">${n(e.name)}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${e.duration_days} days</div></div>
          <div style="font-size:var(--fs-3xl);font-weight:var(--fw-extrabold);color:var(--brand)">${p(e.price)}</div>
        </div>
      </div>`).join("")}
    </div>
    ${s.length===0?'<div class="empty-state"><div class="empty-state-title">No plans available</div></div>':""}
  </div></div>`,m(a,{onBack:()=>l.pop()}),a.querySelectorAll("[data-plan]").forEach(e=>e.addEventListener("click",async()=>{const o=JSON.parse(e.dataset.plan),i=await r("/api/member/v1/renew",{method:"POST",body:{plan_id:o.id}});i.ok?(d("Renewal request submitted!","success"),l.pop()):d(i.error.message,"error")}))}};export{f as default};
