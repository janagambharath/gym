import{a as c,x as o,b as v,e as u,z as m,A as b,i as p,f as d,$ as f,H as h,n as l}from"./index-Cn_Ntmv6.js";const g={async mount(i){i.innerHTML=`${c({title:"Conversations",showBack:!0})}<div class="scroll-view" id="bc-list">${o()}</div>`,v(i,{onBack:()=>l.pop()});async function r(){const t=i.querySelector("#bc-list");t&&(t.innerHTML=o());const a=await u("/api/mobile/v1/bot/conversations"),n=a.ok?a.data.conversations||a.data||[]:[];if(!a.ok){t.innerHTML=m(a.error?.message||"Failed to load"),t.querySelector("#retry-btn")?.addEventListener("click",r);return}if(!Array.isArray(n)||n.length===0){t.innerHTML=b({icon:"chatbubble",title:"No conversations",text:"Bot conversations will appear here"});return}t.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${n.map(e=>{const s=["human_requested","human_active"].includes(e.handover_status);return`
    <div class="list-item" data-cid="${e.id}">
      <div style="width:40px;height:40px;border-radius:var(--r-full);background:${s?"var(--warning-surface)":"var(--brand-subtle)"};display:flex;align-items:center;justify-content:center">
        ${p(s?"alert":"chatbubble",18,s?"var(--warning)":"var(--brand)")}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">${d(e.customer_name||e.phone||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${d(e.state||"")}</div>
      </div>
      <div class="list-item-right">
        <span style="font-size:var(--fs-xs);color:var(--muted)">${f(e.last_message_at)}</span>
        ${s?h("Handover"):""}
      </div>
    </div>`}).join("")}</div></div>`,t.querySelectorAll("[data-cid]").forEach(e=>e.addEventListener("click",()=>l.push("bot-conversation-detail",{conversationId:e.dataset.cid})))}await r()}};export{g as default};
