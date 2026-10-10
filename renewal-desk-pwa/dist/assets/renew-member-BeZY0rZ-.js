import{M as y,f as u,G as f,a as h,B as g,g as s,C as w,r as n,k as x,i as q,b as S,s as m,n as p}from"./index-l_15Hr7r.js";const R={async mount(e,o){const v=y(),r=o?.member?JSON.parse(o.member):null;if(!r){e.innerHTML='<div class="empty-state"><div class="empty-state-title">No member selected</div></div>';return}const i=await u("/api/mobile/v1/settings"),d=i.ok?i.data.plans||[]:[],b=f(r);e.innerHTML=`${h({title:"Renew Membership",showBack:!0})}<div class="scroll-view"><div class="scroll-content form-scroll-content">
    <div class="card card-body" style="margin-bottom:var(--sp-xl);display:flex;align-items:center;gap:var(--sp-md)">
      ${g(r.full_name)} <div><div style="font-weight:var(--fw-bold)">${s(r.full_name)}</div>
      <div style="font-size:var(--fs-sm);color:var(--text-secondary)">${s(r.phone)}</div></div>
      <div style="margin-left:auto">${w(b)}</div></div>
    <form id="renew-form" style="display:flex;flex-direction:column;gap:var(--sp-lg)">
      ${n({id:"rn-plan",label:"Plan",value:r.plan?.id||"",options:d.map(a=>({value:a.id,label:`${a.name} — ${x(a.price)} / ${a.duration_days}d`})),required:!0})}
      ${n({id:"rn-amount",label:"Amount",type:"number",value:r.plan?.price||"",required:!0})}
      ${n({id:"rn-method",label:"Payment Method",value:"cash",options:[{value:"cash",label:"Cash"},{value:"upi",label:"UPI"},{value:"card",label:"Card"},{value:"online",label:"Online"},{value:"other",label:"Other"}],required:!0})}
      ${n({id:"rn-ref",label:"Reference / Transaction ID",placeholder:"Optional"})}
      ${n({id:"rn-notes",label:"Notes",type:"textarea",placeholder:"Optional"})}
      <label style="display:flex;align-items:flex-start;gap:var(--sp-sm);font-size:var(--fs-sm);color:var(--text-secondary);cursor:pointer">
        <input type="checkbox" id="rn-confirm" style="margin-top:3px;width:18px;height:18px;accent-color:var(--brand)">
        <span>I confirm the plan and amount above are correct and approved for ${s(r.full_name)}.</span>
      </label>
      <button type="submit" class="btn btn-primary btn-lg btn-full" id="rn-submit" disabled>${q("renewals",18,"white")} Renew & Record Payment</button>
    </form></div></div>`,S(e,{onBack:()=>p.pop()}),e.querySelector("#rn-plan").addEventListener("change",a=>{const t=d.find(l=>String(l.id)===a.target.value);t&&(e.querySelector("#rn-amount").value=t.price)}),e.querySelector("#rn-confirm").addEventListener("change",a=>{e.querySelector("#rn-submit").disabled=!a.target.checked}),e.querySelector("#renew-form").addEventListener("submit",async a=>{a.preventDefault();const t=e.querySelector("#rn-submit");t.disabled=!0,t.textContent="Processing...";const l={member_id:r.id,plan_id:Number(e.querySelector("#rn-plan").value),amount:e.querySelector("#rn-amount").value,method:e.querySelector("#rn-method").value,reference:e.querySelector("#rn-ref").value.trim()||null,notes:e.querySelector("#rn-notes").value.trim()||null},c=await u("/api/mobile/v1/payments",{method:"POST",body:l,headers:{"Idempotency-Key":v}});c.ok?(m("Renewal recorded!","success"),p.pop()):(m(c.error.message,"error"),t.disabled=!1,t.textContent="Renew & Record Payment")})}};export{R as default};
