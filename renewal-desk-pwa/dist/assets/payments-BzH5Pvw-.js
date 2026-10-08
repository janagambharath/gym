import{a as n,o as r,b as d,e as l,t as o,j as m,f as c,G as v,z as p,n as y}from"./index-DBAqsMek.js";const $={async mount(e){e.innerHTML=`${n({title:"My Payments",showBack:!0})}<div class="scroll-view" id="mp-list">${r()}</div>`,d(e,{onBack:()=>y.pop()});const a=await l("/api/member/v1/payments"),i=e.querySelector("#mp-list"),s=a.ok?a.data.payments||a.data||[]:[];if(!Array.isArray(s)||s.length===0){i.innerHTML=o({icon:"wallet",title:"No payments",text:"Your payment history will appear here"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${s.map(t=>`
    <div class="list-item"><div class="list-item-content">
      <div class="list-item-title">${m(t.amount)}</div>
      <div class="list-item-subtitle">${c(t.method||"")} · ${v(t.paid_on||t.created_at)}</div>
    </div>${p(t.status||"paid")}</div>`).join("")}</div></div>`}};export{$ as default};
