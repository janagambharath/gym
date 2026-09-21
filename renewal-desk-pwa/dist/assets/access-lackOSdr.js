import{a as r,z as n,b as c,k as d,A as l,i as v,N as o,n as m}from"./index-D6Fm9ZNQ.js";const y={async mount(t){t.innerHTML=`${r({title:"Attendance",showBack:!0})}<div class="scroll-view" id="ma-list">${n()}</div>`,c(t,{onBack:()=>m.pop()});const s=await d("/api/member/v1/access"),i=t.querySelector("#ma-list"),a=s.ok?s.data.events||s.data||[]:[];if(!Array.isArray(a)||a.length===0){i.innerHTML=l({icon:"access",title:"No attendance records",text:"Your gym visits will appear here"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${a.map(e=>`
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:var(--r-full);background:${e.event_type==="entry"?"var(--success-surface)":"var(--gray-100)"};display:flex;align-items:center;justify-content:center">
        ${v(e.event_type==="entry"?"forward":"back",14,e.event_type==="entry"?"var(--success)":"var(--muted)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${e.event_type==="entry"?"Check In":"Check Out"}</div>
        <div class="list-item-subtitle">${o(e.timestamp||e.created_at)}</div>
      </div>
    </div>`).join("")}</div></div>`}};export{y as default};
