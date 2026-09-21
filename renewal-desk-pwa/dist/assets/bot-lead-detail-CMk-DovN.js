import{k as p,a as i,b as o,e as r,D as b,I as e,N as m,i as l,n as d}from"./index-DBor-WEA.js";const g={async mount(a,c){const v=c?.leadId,s=await p(`/api/mobile/v1/bot/leads/${v}`);if(!s.ok){a.innerHTML=`${i({title:"Lead",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Lead not found</div></div>`,o(a,{onBack:()=>d.pop()});return}const t=s.data;a.innerHTML=`${i({title:"Lead Detail",showBack:!0})}<div class="scroll-view"><div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)">
      <h2 style="margin-bottom:var(--sp-sm)">${r(t.name||t.phone||"Unknown")}</h2>
      ${b(t.status||"new")}
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${e("Phone",t.phone||"—")}
      ${e("Name",t.name||"—")}
      ${e("Source",t.source||"Bot")}
      ${e("Status",t.status||"new")}
      ${e("Created",m(t.created_at))}
      ${t.notes?e("Notes",t.notes):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      <button class="btn btn-primary btn-full" id="ld-convert">${l("add",18,"white")} Convert to Member</button>
      <button class="btn btn-whatsapp btn-full" id="ld-wa">${l("whatsapp",18,"white")} Send WhatsApp</button>
    </div>
    ${t.transcript&&t.transcript.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Conversation</div>
      <div class="chat-container" style="padding:0">${t.transcript.map(n=>`<div class="chat-bubble ${n.role==="bot"?"bot":"incoming"}">${r(n.content||n.text||"")}</div>`).join("")}</div>
    </div></div>`:""}
  </div></div>`,o(a,{onBack:()=>d.pop()}),a.querySelector("#ld-convert")?.addEventListener("click",()=>d.push("add-member")),a.querySelector("#ld-wa")?.addEventListener("click",()=>{t.phone&&window.open(`https://wa.me/${t.phone.replace(/\D/g,"")}`,"_blank")})}};export{g as default};
