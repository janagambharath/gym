import{f as c,a as d,t as v,b as l,n as o,g as m,w as p,i as y,G as u}from"./index-8vE_Qb-N.js";const h={async mount(e){await n(e),c(e,()=>n(e,!0))}};async function n(e,a=!1){a||(e.innerHTML=`${d({title:"Attendance",showBack:!0})}<div class="scroll-view" id="ma-list">${v()}</div>`),a||l(e,{onBack:()=>o.pop()});const s=await m("/api/member/v1/access");if(e.dataset.screenDisposed==="true"||a&&!s.ok)return;const r=e.querySelector("#ma-list"),i=s.ok?s.data.events||s.data||[]:[];if(!Array.isArray(i)||i.length===0){r.innerHTML=p({icon:"access",title:"No attendance records",text:"Your gym visits will appear here"});return}r.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${i.map(t=>`
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:var(--r-full);background:${t.event_type==="entry"?"var(--success-surface)":"var(--gray-100)"};display:flex;align-items:center;justify-content:center">
        ${y(t.event_type==="entry"?"forward":"back",14,t.event_type==="entry"?"var(--success)":"var(--muted)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${t.event_type==="entry"?"Check In":"Check Out"}</div>
        <div class="list-item-subtitle">${u(t.timestamp||t.created_at)}</div>
      </div>
    </div>`).join("")}</div></div>`}export{h as default};
