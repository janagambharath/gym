import{e as m,a as d,z as u,b as l,n,f as c,H as g,P as t,w as h,i as v}from"./index-CIkiyrdY.js";const y={async mount(a,p){const b=p?.leadId;async function i(){const s=await m(`/api/mobile/v1/bot/leads/${b}`);if(!s.ok){s.error?.status===404?a.innerHTML=`${d({title:"Lead",showBack:!0})}<div class="empty-state"><div class="empty-state-title">Lead not found</div></div>`:(a.innerHTML=`${d({title:"Lead",showBack:!0})}<div class="scroll-view">${u(s.error?.message||"Failed to load")}</div>`,a.querySelector("#retry-btn")?.addEventListener("click",i)),l(a,{onBack:()=>n.pop()});return}const e=s.data.lead||{},r=s.data.messages||[];a.innerHTML=`${d({title:"Lead Detail",showBack:!0})}<div class="scroll-view"><div class="scroll-content">
    <div style="padding:var(--sp-xxl);text-align:center;background:var(--card)">
      <h2 style="margin-bottom:var(--sp-sm)">${c(e.name||e.phone||"Unknown")}</h2>
      ${g(e.status||"new")}
    </div>
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      ${t("Phone",e.phone||"—")}
      ${t("Name",e.name||"—")}
      ${t("Source",e.source||"Bot")}
      ${t("Status",e.status||"new")}
      ${t("Created",h(e.created_at))}
      ${e.notes?t("Notes",e.notes):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;flex-direction:column;gap:var(--sp-sm)">
      <button class="btn btn-primary btn-full" id="ld-convert">${v("add",18,"white")} Convert to Member</button>
      <button class="btn btn-whatsapp btn-full" id="ld-wa">${v("whatsapp",18,"white")} Send WhatsApp</button>
    </div>
    ${r.length?`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="card card-body">
      <div style="font-weight:var(--fw-bold);margin-bottom:var(--sp-md)">Conversation</div>
      <div class="chat-container" style="padding:0">${r.map(o=>`<div class="chat-bubble ${o.sender==="bot"?"bot":"incoming"}">${c(o.body||"")}</div>`).join("")}</div>
    </div></div>`:""}
  </div></div>`,l(a,{onBack:()=>n.pop()}),a.querySelector("#ld-convert")?.addEventListener("click",()=>n.push("add-member",{prefill:JSON.stringify({name:e.name||"",phone:e.phone||""})})),a.querySelector("#ld-wa")?.addEventListener("click",()=>{e.phone&&window.open(`https://wa.me/${e.phone.replace(/\D/g,"")}`,"_blank")})}await i()}};export{y as default};
