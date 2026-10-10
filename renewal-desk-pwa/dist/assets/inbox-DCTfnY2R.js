import{a as r,p as o,b as l,f as d,u as c,z as v,g as n,N as m,n as p}from"./index-Bvpm40oj.js";const u={async mount(s){s.innerHTML=`${r({title:"Inbox",showBack:!0})}<div class="scroll-view" id="ib-list">${o()}</div>`,l(s,{onBack:()=>p.pop()});const t=await d("/api/mobile/v1/inbox"),i=s.querySelector("#ib-list"),a=t.ok?t.data.messages||t.data||[]:[];if(!Array.isArray(a)||a.length===0){i.innerHTML=c({icon:"inbox",title:"Inbox empty",text:"No messages yet"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${a.map(e=>`
    <div class="list-item">
      ${v(e.sender_name||e.from||"?")}
      <div class="list-item-content">
        <div class="list-item-title">${n(e.sender_name||e.from||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${n(e.preview||e.text||e.message||"")}</div>
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted)">${m(e.created_at)}</span>
    </div>`).join("")}</div></div>`}};export{u as default};
