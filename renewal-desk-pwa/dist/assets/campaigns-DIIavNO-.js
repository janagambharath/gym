import{a as d,z as l,b as o,k as p,A as m,n as t,i as v,e as r,S as c,u as g,N as u,D as h}from"./index-DBor-WEA.js";const f={async mount(i){i.innerHTML=`${d({title:"Campaigns",showBack:!0,actions:[{icon:"add",label:"New"}]})}<div class="scroll-view" id="cp-list">${l()}</div>`,o(i,{onBack:()=>t.pop(),actions:[{onClick:()=>t.push("campaign-create")}]});const s=await p("/api/mobile/v1/campaigns"),e=i.querySelector("#cp-list"),n=s.ok?s.data.campaigns||s.data||[]:[];if(!Array.isArray(n)||n.length===0){e.innerHTML=m({icon:"megaphone",title:"No campaigns",text:"Create your first WhatsApp campaign",actionText:"New Campaign",actionId:"cp-new"}),e.querySelector("#cp-new")?.addEventListener("click",()=>t.push("campaign-create"));return}e.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${n.map(a=>`
    <div class="list-item" data-cid="${a.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-lg);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${v("megaphone",18,"var(--brand)")}</div>
      <div class="list-item-content">
        <div class="list-item-title">${r(a.name||c[a.segment]||"Campaign")}</div>
        <div class="list-item-subtitle">${r(c[a.segment]||a.segment||"")} · ${g(a.recipient_count||0)} recipients</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${u(a.created_at)}</span>
        ${h(a.status||"draft")}
      </div>
    </div>`).join("")}</div></div>`,e.querySelectorAll("[data-cid]").forEach(a=>a.addEventListener("click",()=>t.push("campaign-detail",{campaignId:a.dataset.cid})))}};export{f as default};
