import{z as g,a as y,x as R,b as u,n as p,g as b,y as H,N as M,O as P,j as v,P as w,u as c,Q as S,H as h,A as x,o as k}from"./index-ByhK-z4i.js";const E={async mount(e,a){await _(e,a)}};async function $(e,a){const t=[],d=new Set;let i=1,s=1/0;for(;t.length<s&&i<=20;){const l=e.includes("?")?"&":"?",n=await b(`${e}${l}page=${i}&page_size=100`);if(!n.ok)return{ok:!1,error:n.error,items:t};const f=n.data?.[a]||[];for(const m of f){const r=m.id??JSON.stringify(m);d.has(r)||(d.add(r),t.push(m))}if(s=n.data?.pagination?.total??t.length,f.length===0)break;i+=1}return{ok:!0,items:t}}function B(e){const o=[`${c(e.new_start)} → ${c(e.new_end)}`,e.channel].filter(Boolean).join(" · ");return`
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${v(e.plan_name||"Membership Renewal")}</div>
        <div class="list-item-subtitle">${v(o)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${k(e.amount)}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-secondary)">${c(e.created_at)}</span>
      </div>
    </div>`}function L(e){const a=[e.method,c(e.paid_on||e.created_at),e.renewal_days?`${e.renewal_days} days`:null,e.reference?`Ref: ${e.reference}`:null].filter(Boolean).join(" · ");return`
    <div class="list-item" data-payment-id="${e.id}">
      <div class="list-item-content">
        <div class="list-item-title">${v(e.plan_name||"Payment")}</div>
        <div class="list-item-subtitle">${v(a)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${k(e.amount)}</span>
        ${h(e.status)}
      </div>
    </div>`}async function _(e,a){const o=a?.memberId;if(!o){e.innerHTML=g("Member not found");return}e.innerHTML=`
    ${y({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">${R()}</div>`,u(e,{onBack:()=>p.pop()});const[t,d,i]=await Promise.all([b(`/api/mobile/v1/members/${o}`),$(`/api/mobile/v1/renewals?member_id=${o}`,"renewals"),$(`/api/mobile/v1/payments?member_id=${o}`,"payments")]);for(const r of[t,d,i])if(!r.ok&&r.error?.status===401)return H();if(!t.ok){e.innerHTML=`
      ${y({title:"Renewal History",showBack:!0})}
      <div class="scroll-view">${g(t.error?.message||"Member not found")}</div>`,u(e,{onBack:()=>p.pop()}),e.querySelector("#retry-btn")?.addEventListener("click",()=>_(e,a));return}const s=t.data,l=d.ok?d.items:[],n=i.ok?i.items:[],f=M(s),m=P(s.days_until_expiry);e.innerHTML=`
    ${y({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">
      <div class="scroll-content">
        <!-- Current Membership -->
        <div style="padding:var(--sp-lg)">
          <div class="card card-body">
            <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${v(s.full_name)}</div>
            ${w("Plan",s.plan?.name||"—")}
            ${w("Period",`${c(s.membership_start)} → ${c(s.membership_end)}`)}
            ${S("Status",h(f))}
            ${m?w("Days Left",m):""}
          </div>
        </div>

        <!-- Renewal Periods -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership Renewals${l.length?` (${l.length})`:""}</div>
          ${d.ok?l.length?`<div class="card">${l.map(B).join("")}</div>`:'<div style="font-size:var(--fs-sm);color:var(--muted)">No renewals recorded for this member.</div>':'<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load renewals.</div>'}
        </div>

        <!-- Payments -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Payments${n.length?` (${n.length})`:""}</div>
          ${i.ok?n.length?`<div class="card">${n.map(L).join("")}</div>`:x({icon:"payments",title:"No payments",text:`No payments recorded for ${s.full_name}`}):'<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load payments.</div>'}
        </div>
      </div>
    </div>`,u(e,{onBack:()=>p.pop()}),e.querySelectorAll("[data-payment-id]").forEach(r=>{r.addEventListener("click",()=>p.push("payment-detail",{paymentId:r.dataset.paymentId}))})}export{E as default};
