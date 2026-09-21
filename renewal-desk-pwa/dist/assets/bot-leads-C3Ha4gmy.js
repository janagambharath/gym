import{a as n,z as l,b as o,k as c,A as v,f as m,e as d,L as p,x as u,n as r}from"./index-1Q0YpctZ.js";const L={async mount(a){a.innerHTML=`${n({title:"Leads",showBack:!0})}<div class="scroll-view" id="bl-list">${l()}</div>`,o(a,{onBack:()=>r.pop()});const t=await c("/api/mobile/v1/bot/leads"),s=a.querySelector("#bl-list"),i=t.ok?t.data.leads||t.data||[]:[];if(!Array.isArray(i)||i.length===0){s.innerHTML=v({icon:"target",title:"No leads yet",text:"Leads from bot conversations will appear here"});return}s.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${i.map(e=>`
    <div class="list-item" data-lid="${e.id}">
      ${m(e.name||e.phone||"Lead")}
      <div class="list-item-content">
        <div class="list-item-title">${d(e.name||e.phone||"Unknown")}</div>
        <div class="list-item-subtitle">${d(e.phone||"")} ${e.source?"· "+d(e.source):""}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${p(e.created_at)}</span>
        ${u(e.status||"new")}
      </div>
    </div>`).join("")}</div></div>`,s.querySelectorAll("[data-lid]").forEach(e=>e.addEventListener("click",()=>r.push("bot-lead-detail",{leadId:e.dataset.lid})))}};export{L as default};
