import{u as $,a as p,q as R,b as y,n as c,f as g,t as H,G as M,H as x,g as m,I as f,J as d,C as w,v as B,k as h}from"./index-BzFXz63b.js";const I={async mount(e,s){await k(e,s)}};async function b(e,s){const t=[];let n=1,i=1/0;for(;t.length<i;){const o=e.includes("?")?"&":"?",a=await g(`${e}${o}page=${n}&page_size=100`);if(!a.ok)return{ok:!1,error:a.error,items:t};const r=a.data?.[s]||[];if(t.push(...r),i=a.data?.pagination?.total??t.length,r.length===0)break;n+=1}return{ok:!0,items:t}}function L(e){const t=[`${d(e.new_start)} → ${d(e.new_end)}`,e.channel].filter(Boolean).join(" · ");return`
    <div class="list-item">
      <div class="list-item-content">
        <div class="list-item-title">${m(e.plan_name||"Membership Renewal")}</div>
        <div class="list-item-subtitle">${m(t)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${h(e.amount)}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-secondary)">${d(e.created_at)}</span>
      </div>
    </div>`}function P(e){const s=[e.method,d(e.paid_on||e.created_at),e.renewal_days?`${e.renewal_days} days`:null,e.reference?`Ref: ${e.reference}`:null].filter(Boolean).join(" · ");return`
    <div class="list-item" data-payment-id="${e.id}">
      <div class="list-item-content">
        <div class="list-item-title">${m(e.plan_name||"Payment")}</div>
        <div class="list-item-subtitle">${m(s)}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-base);font-weight:var(--fw-bold);color:var(--text)">${h(e.amount)}</span>
        ${w(e.status)}
      </div>
    </div>`}async function k(e,s){const t=s?.memberId;if(!t){e.innerHTML=$("Member not found");return}e.innerHTML=`
    ${p({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">${R()}</div>`,y(e,{onBack:()=>c.pop()});const[n,i,o]=await Promise.all([g(`/api/mobile/v1/members/${t}`),b(`/api/mobile/v1/renewals?member_id=${t}`,"renewals"),b(`/api/mobile/v1/payments?member_id=${t}`,"payments")]);for(const l of[n,i,o])if(!l.ok&&l.error?.status===401)return H();if(!n.ok){e.innerHTML=`
      ${p({title:"Renewal History",showBack:!0})}
      <div class="scroll-view">${$(n.error?.message||"Member not found")}</div>`,y(e,{onBack:()=>c.pop()}),e.querySelector("#retry-btn")?.addEventListener("click",()=>k(e,s));return}const a=n.data,r=i.ok?i.items:[],v=o.ok?o.items:[],_=M(a),u=x(a.days_until_expiry);e.innerHTML=`
    ${p({title:"Renewal History",showBack:!0})}
    <div class="scroll-view">
      <div class="scroll-content">
        <!-- Current Membership -->
        <div style="padding:var(--sp-lg)">
          <div class="card card-body">
            <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">${m(a.full_name)}</div>
            ${f("Plan",a.plan?.name||"—")}
            ${f("Period",`${d(a.membership_start)} → ${d(a.membership_end)}`)}
            ${f("Status",w(_))}
            ${u?f("Days Left",u):""}
          </div>
        </div>

        <!-- Renewal Periods -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Membership Renewals${r.length?` (${r.length})`:""}</div>
          ${i.ok?r.length?`<div class="card">${r.map(L).join("")}</div>`:'<div style="font-size:var(--fs-sm);color:var(--muted)">No renewals recorded for this member.</div>':'<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load renewals.</div>'}
        </div>

        <!-- Payments -->
        <div style="padding:0 var(--sp-lg) var(--sp-lg)">
          <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Payments${v.length?` (${v.length})`:""}</div>
          ${o.ok?v.length?`<div class="card">${v.map(P).join("")}</div>`:B({icon:"payments",title:"No payments",text:`No payments recorded for ${a.full_name}`}):'<div style="font-size:var(--fs-sm);color:var(--muted)">Could not load payments.</div>'}
        </div>
      </div>
    </div>`,y(e,{onBack:()=>c.pop()}),e.querySelectorAll("[data-payment-id]").forEach(l=>{l.addEventListener("click",()=>c.push("payment-detail",{paymentId:l.dataset.paymentId}))})}export{I as default};
