import{a as r,z as o,b as l,k as d,A as c,f as v,e as n,O as m,n as p}from"./index-DBor-WEA.js";const f={async mount(s){s.innerHTML=`${r({title:"Inbox",showBack:!0})}<div class="scroll-view" id="ib-list">${o()}</div>`,l(s,{onBack:()=>p.pop()});const t=await d("/api/mobile/v1/inbox"),i=s.querySelector("#ib-list"),a=t.ok?t.data.messages||t.data||[]:[];if(!Array.isArray(a)||a.length===0){i.innerHTML=c({icon:"inbox",title:"Inbox empty",text:"No messages yet"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${a.map(e=>`
    <div class="list-item">
      ${v(e.sender_name||e.from||"?")}
      <div class="list-item-content">
        <div class="list-item-title">${n(e.sender_name||e.from||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${n(e.preview||e.text||e.message||"")}</div>
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted)">${m(e.created_at)}</span>
    </div>`).join("")}</div></div>`}};export{f as default};
