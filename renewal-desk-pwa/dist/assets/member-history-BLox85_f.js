import{z as w,a as u,x as R,b,n as p,e as h,y as S,Q as H,R as x,f as l,S as g,t as v,T as M,H as k,A as L,m as _}from"./index-DYUtf5t4.js";const B={async mount(e,t){await f(e,t)}};async function $(e,t){const s=[],r=new Set;let n=1,a=1/0;for(;s.length<a&&n<=20;){const c=e.includes("?")?"&":"?",i=await h(`${e}${c}page=${n}&page_size=100`);if(!i.ok)return{ok:!1,error:i.error,items:s};const y=i.data?.[t]||[];for(const m of y){const o=m.id??JSON.stringify(m);r.has(o)||(r.add(o),s.push(m))}if(a=i.data?.pagination?.total??s.length,y.length===0)break;n+=1}return{ok:!0,items:s}}function P(e){const d=[`${v(e.new_start)} → ${v(e.new_end)}`,e.channel].filter(Boolean).join(" · ");return`
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${l(e.plan_name||"Membership Renewal")}</div>
        <div class="list-item-subtitle">${l(d)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${_(e.amount)}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-secondary)">${v(e.created_at)}</span>
      </div>
    </div>`}function E(e){const t=[e.method,v(e.paid_on||e.created_at),e.renewal_days?`${e.renewal_days} days`:null,e.reference?`Ref: ${e.reference}`:null].filter(Boolean).join(" · ");return`
    <div class="list-item" data-payment-id="${e.id}">
      <div class="list-item-content">
        <div class="list-item-title">${l(e.plan_name||"Payment")}</div>
        <div class="list-item-subtitle">${l(t)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${_(e.amount)}</span>
        ${k(e.status)}
      </div>
    </div>`}async function f(e,t){const d=t?.memberId;if(!d){e.innerHTML=w("Member not found");return}e.innerHTML=`
    ${u({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">${R()}</div>`,b(e,{onBack:()=>p.pop()});const[s,r,n]=await Promise.all([h(`/api/mobile/v1/members/${d}`),$(`/api/mobile/v1/renewals?member_id=${d}`,"renewals"),$(`/api/mobile/v1/payments?member_id=${d}`,"payments")]);for(const o of[s,r,n])if(!o.ok&&o.error?.status===401)return S();if(!s.ok){e.innerHTML=`
      ${u({title:"Renewal History",showBack:!0})}
      <div class="scroll-view">${w(s.error?.message||"Member not found")}</div>`,b(e,{onBack:()=>p.pop()}),e.querySelector("#retry-btn")?.addEventListener("click",()=>f(e,t));return}const a=s.data,c=r.ok?r.items:[],i=n.ok?n.items:[],y=H(a),m=x(a.days_until_expiry);e.innerHTML=`
    ${u({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">
      <div class="scroll-content">
        <!-- Current Membership -->
        <div style="padding:var(--sp-lg)">
          <div class="card card-body">
            <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${l(a.full_name)}</div>
            ${g("Plan",a.plan?.name||"—")}
            ${g("Period",`${v(a.membership_start)} → ${v(a.membership_end)}`)}
            ${M("Status",k(y))}
            ${m?g("Days Left",m):""}
          </div>
        </div>

        <!-- Renewal Periods -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership Renewals${c.length?` (${c.length})`:""}</div>
          ${r.ok?c.length?`<div class="card">${c.map(P).join("")}</div>`:'<div style="font-size:var(--fs-sm);color:var(--muted)">No renewals recorded for this member.</div>':`<div class="empty-state" style="padding:var(--sp-md)"><div class="empty-state-text">Could not load renewals: ${l(r.error?.message||"check your connection")}</div><button class="btn btn-primary" id="retry-renewals">Try Again</button></div>`}
        </div>

        <!-- Payments -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Payments${i.length?` (${i.length})`:""}</div>
          ${n.ok?i.length?`<div class="card">${i.map(E).join("")}</div>`:L({icon:"payments",title:"No payments",text:`No payments recorded for ${a.full_name}`}):`<div class="empty-state" style="padding:var(--sp-md)"><div class="empty-state-text">Could not load payments: ${l(n.error?.message||"check your connection")}</div><button class="btn btn-primary" id="retry-payments">Try Again</button></div>`}
        </div>
      </div>
    </div>`,b(e,{onBack:()=>p.pop()}),e.querySelector("#retry-renewals")?.addEventListener("click",()=>f(e,t)),e.querySelector("#retry-payments")?.addEventListener("click",()=>f(e,t)),e.querySelectorAll("[data-payment-id]").forEach(o=>{o.addEventListener("click",()=>p.push("payment-detail",{paymentId:o.dataset.paymentId}))})}export{B as default};
