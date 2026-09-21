import{a as o,z as d,b as l,k as v,A as c,i as u,e as n,O as b,C as m,n as r}from"./index-DcA9rnoc.js";const h={async mount(a){a.innerHTML=`${o({title:"Conversations",showBack:!0})}<div class="scroll-view" id="bc-list">${d()}</div>`,l(a,{onBack:()=>r.pop()});const t=await v("/api/mobile/v1/bot/conversations"),s=a.querySelector("#bc-list"),i=t.ok?t.data.conversations||t.data||[]:[];if(!Array.isArray(i)||i.length===0){s.innerHTML=c({icon:"chatbubble",title:"No conversations",text:"Bot conversations will appear here"});return}s.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${i.map(e=>`
    <div class="list-item" data-cid="${e.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-full);background:${e.needs_handover?"var(--warning-surface)":"var(--brand-subtle)"};display:flex;align-items:center;justify-content:center">
        ${u(e.needs_handover?"alert":"chatbubble",18,e.needs_handover?"var(--warning)":"var(--brand)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${n(e.customer_name||e.phone||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${n(e.last_message||"No messages")}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${b(e.updated_at||e.created_at)}</span>
        ${e.needs_handover?m("Handover"):""}
      </div>
    </div>`).join("")}</div></div>`,s.querySelectorAll("[data-cid]").forEach(e=>e.addEventListener("click",()=>r.push("bot-conversation-detail",{conversationId:e.dataset.cid})))}};export{h as default};
