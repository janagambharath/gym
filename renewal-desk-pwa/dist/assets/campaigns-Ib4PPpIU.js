import{a as o,x as d,b as p,e as m,z as v,A as g,n as i,i as u,f as c,a1 as l,k as y,m as f,H as h}from"./index-Cn_Ntmv6.js";const k={async mount(s){s.innerHTML=`${o({title:"Campaigns",showBack:!0,actions:[{icon:"add",label:"New"}]})}<div class="scroll-view" id="cp-list">${d()}</div>`,p(s,{onBack:()=>i.pop(),actions:[{onClick:()=>i.push("campaign-create")}]});async function r(){const a=s.querySelector("#cp-list");a&&(a.innerHTML=d());const t=await m("/api/mobile/v1/campaigns"),n=t.ok?t.data.campaigns||t.data||[]:[];if(!t.ok){a.innerHTML=v(t.error?.message||"Failed to load"),a.querySelector("#retry-btn")?.addEventListener("click",r);return}if(!Array.isArray(n)||n.length===0){a.innerHTML=g({icon:"megaphone",title:"No campaigns",text:"Create your first WhatsApp campaign",actionText:"New Campaign",actionId:"cp-new"}),a.querySelector("#cp-new")?.addEventListener("click",()=>i.push("campaign-create"));return}a.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${n.map(e=>`
    <div class="list-item" data-cid="${e.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-lg);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${u("megaphone",18,"var(--brand)")}</div>
      <div class="list-item-content">
        <div class="list-item-title">${c(e.name||l[e.segment_type]||"Campaign")}</div>
        <div class="list-item-subtitle">${c(l[e.segment_type]||e.segment_type||"")} · ${y(e.total_recipients??0)} recipients</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${f(e.created_at)}</span>
        ${h(e.status||"draft")}
      </div>
    </div>`).join("")}</div></div>`,a.querySelectorAll("[data-cid]").forEach(e=>e.addEventListener("click",()=>i.push("campaign-detail",{campaignId:e.dataset.cid})))}await r()}};export{k as default};
