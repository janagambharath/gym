import{a as n,p as r,b as d,f as l,u as o,k as m,g as c,I as p,A as v,n as y}from"./index-CekIYfVW.js";const $={async mount(a){a.innerHTML=`${n({title:"My Payments",showBack:!0})}<div class="scroll-view" id="mp-list">${r()}</div>`,d(a,{onBack:()=>y.pop()});const e=await l("/api/member/v1/payments"),i=a.querySelector("#mp-list"),s=e.ok?e.data.payments||e.data||[]:[];if(!Array.isArray(s)||s.length===0){i.innerHTML=o({icon:"wallet",title:"No payments",text:"Your payment history will appear here"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${s.map(t=>`
    <div class="list-item"><div class="list-item-content">
      <div class="list-item-title">${m(t.amount)}</div>
      <div class="list-item-subtitle">${c(t.method||"")} · ${p(t.paid_on||t.created_at)}</div>
    </div>${v(t.status||"paid")}</div>`).join("")}</div></div>`}};export{$ as default};
