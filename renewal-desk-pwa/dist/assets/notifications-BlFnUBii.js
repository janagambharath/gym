import{a as o,z as l,b as c,k as d,A as v,i as p,e as n,O as m,n as f}from"./index-DcA9rnoc.js";const y={async mount(a){a.innerHTML=`${o({title:"Notifications",showBack:!0})}<div class="scroll-view" id="nf-list">${l()}</div>`,c(a,{onBack:()=>f.pop()});const i=await d("/api/mobile/v1/notifications"),s=a.querySelector("#nf-list"),e=i.ok?i.data.notifications||i.data||[]:[];if(!Array.isArray(e)||e.length===0){s.innerHTML=v({icon:"notifications",title:"No notifications",text:"You're all caught up!"});return}s.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${e.map(t=>{const r={payment:"wallet",renewal:"renewals",member:"person",whatsapp:"whatsapp",bot:"robot",campaign:"megaphone"}[t.type]||"notifications";return`<div class="list-item" style="${t.read?"":"background:var(--brand-subtle)"}">
      <div style="width:36px;height:36px;border-radius:var(--r-full);background:var(--brand-subtle);display:flex;align-items:center;justify-content:center">${p(r,16,"var(--brand)")}</div>
      <div class="list-item-content">
        <div class="list-item-title" style="font-weight:${t.read?"var(--fw-normal)":"var(--fw-bold)"}">${n(t.title||t.message||"")}</div>
        ${t.body?`<div class="list-item-subtitle">${n(t.body)}</div>`:""}
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted);white-space:nowrap">${m(t.created_at)}</span>
    </div>`}).join("")}</div></div>`}};export{y as default};
