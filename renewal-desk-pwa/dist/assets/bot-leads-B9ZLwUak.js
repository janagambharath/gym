import{a as l,x as d,b as c,e as v,z as m,A as p,G as u,f as r,Y as f,H as y,n as o}from"./index-Dt9-M7Kn.js";const b={async mount(s){s.innerHTML=`${l({title:"Leads",showBack:!0})}<div class="scroll-view" id="bl-list">${d()}</div>`,c(s,{onBack:()=>o.pop()});async function n(){const a=s.querySelector("#bl-list");a&&(a.innerHTML=d());const t=await v("/api/mobile/v1/bot/leads"),i=t.ok?t.data.leads||t.data||[]:[];if(!t.ok){a.innerHTML=m(t.error?.message||"Failed to load"),a.querySelector("#retry-btn")?.addEventListener("click",n);return}if(!Array.isArray(i)||i.length===0){a.innerHTML=p({icon:"target",title:"No leads yet",text:"Leads from bot conversations will appear here"});return}a.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${i.map(e=>`
    <div class="list-item" data-lid="${e.id}">
      ${u(e.name||e.phone||"Lead")}
      <div class="list-item-content">
        <div class="list-item-title">${r(e.name||e.phone||"Unknown")}</div>
        <div class="list-item-subtitle">${r(e.phone||"")} ${e.source?"· "+r(e.source):""}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${f(e.created_at)}</span>
        ${y(e.status||"new")}
      </div>
    </div>`).join("")}</div></div>`,a.querySelectorAll("[data-lid]").forEach(e=>e.addEventListener("click",()=>o.push("bot-lead-detail",{leadId:e.dataset.lid})))}await n()}};export{b as default};
