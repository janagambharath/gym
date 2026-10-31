import{a as d,q as l,b as c,f as v,v as u,i as m,g as r,O as b,C as p,n as o}from"./index-rYiQ1GM-.js";const g={async mount(a){a.innerHTML=`${d({title:"Conversations",showBack:!0})}<div class="scroll-view" id="bc-list">${l()}</div>`,c(a,{onBack:()=>o.pop()});const s=await v("/api/mobile/v1/bot/conversations"),i=a.querySelector("#bc-list"),n=s.ok?s.data.conversations||s.data||[]:[];if(!Array.isArray(n)||n.length===0){i.innerHTML=u({icon:"chatbubble",title:"No conversations",text:"Bot conversations will appear here"});return}i.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${n.map(e=>{const t=["human_requested","human_active"].includes(e.handover_status);return`
    <div class="list-item" data-cid="${e.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-full);background:${t?"var(--warning-surface)":"var(--brand-subtle)"};display:flex;align-items:center;justify-content:center">
        ${m(t?"alert":"chatbubble",18,t?"var(--warning)":"var(--brand)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${r(e.customer_name||e.phone||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${r(e.state||"")}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${b(e.last_message_at)}</span>
        ${t?p("Handover"):""}
      </div>
    </div>`}).join("")}</div></div>`,i.querySelectorAll("[data-cid]").forEach(e=>e.addEventListener("click",()=>o.push("bot-conversation-detail",{conversationId:e.dataset.cid})))}};export{g as default};
