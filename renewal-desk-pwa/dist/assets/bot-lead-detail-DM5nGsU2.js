import{f as b,a as o,b as r,g as l,C as m,I as t,F as g,i as c,n as d}from"./index-CIqhXi65.js";const h={async mount(a,v){const p=v?.leadId,s=await b(`/api/mobile/v1/bot/leads/${p}`);if(!s.ok){a.innerHTML=`${o({title:"Lead",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Lead not found</div></div>`,r(a,{onBack:()=>d.pop()});return}const e=s.data.lead||{},n=s.data.messages||[];a.innerHTML=`${o({title:"Lead Detail",showBack:!0})}<div class="scroll-view"><div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)">
      <h2 style="margin-bottom:var(--sp-sm)">${l(e.name||e.phone||"Unknown")}</h2>
      ${m(e.status||"new")}
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${t("Phone",e.phone||"—")}
      ${t("Name",e.name||"—")}
      ${t("Source",e.source||"Bot")}
      ${t("Status",e.status||"new")}
      ${t("Created",g(e.created_at))}
      ${e.notes?t("Notes",e.notes):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      <button class="btn btn-primary btn-full" id="ld-convert">${c("add",18,"white")} Convert to Member</button>
      <button class="btn btn-whatsapp btn-full" id="ld-wa">${c("whatsapp",18,"white")} Send WhatsApp</button>
    </div>
    ${n.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Conversation</div>
      <div class="chat-container" style="padding:0">${n.map(i=>`<div class="chat-bubble ${i.sender==="bot"?"bot":"incoming"}">${l(i.body||"")}</div>`).join("")}</div>
    </div></div>`:""}
  </div></div>`,r(a,{onBack:()=>d.pop()}),a.querySelector("#ld-convert")?.addEventListener("click",()=>d.push("add-member",{prefill:JSON.stringify({name:e.name||"",phone:e.phone||""})})),a.querySelector("#ld-wa")?.addEventListener("click",()=>{e.phone&&window.open(`https://wa.me/${e.phone.replace(/\D/g,"")}`,"_blank")})}};export{h as default};
