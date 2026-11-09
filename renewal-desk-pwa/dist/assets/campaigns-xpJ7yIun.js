import{a as o,x as c,b as p,e as m,z as v,A as g,n as i,i as u,f as d,a0 as l,k as f,w as y,H as h}from"./index-Dt9-M7Kn.js";const k={async mount(s){s.innerHTML=`${o({title:"Campaigns",showBack:!0,actions:[{icon:"add",label:"New"}]})}<div class="scroll-view" id="cp-list">${c()}</div>`,p(s,{onBack:()=>i.pop(),actions:[{onClick:()=>i.push("campaign-create")}]});async function r(){const e=s.querySelector("#cp-list");e&&(e.innerHTML=c());const t=await m("/api/mobile/v1/campaigns"),n=t.ok?t.data.campaigns||t.data||[]:[];if(!t.ok){e.innerHTML=v(t.error?.message||"Failed to load"),e.querySelector("#retry-btn")?.addEventListener("click",r);return}if(!Array.isArray(n)||n.length===0){e.innerHTML=g({icon:"megaphone",title:"No campaigns",text:"Create your first WhatsApp campaign",actionText:"New Campaign",actionId:"cp-new"}),e.querySelector("#cp-new")?.addEventListener("click",()=>i.push("campaign-create"));return}e.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${n.map(a=>`
    <div class="list-item" data-cid="${a.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-lg);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${u("megaphone",18,"var(--brand)")}</div>
      <div class="list-item-content">
        <div class="list-item-title">${d(a.name||l[a.segment]||"Campaign")}</div>
        <div class="list-item-subtitle">${d(l[a.segment]||a.segment||"")} · ${f(a.recipient_count||0)} recipients</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${y(a.created_at)}</span>
        ${h(a.status||"draft")}
      </div>
    </div>`).join("")}</div></div>`,e.querySelectorAll("[data-cid]").forEach(a=>a.addEventListener("click",()=>i.push("campaign-detail",{campaignId:a.dataset.cid})))}await r()}};export{k as default};
