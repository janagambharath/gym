import{a as m,q as g,b as u,f as c,i as t,B as r,I as d,y as b,g as p,F as h,n}from"./index-0beHVmet.js";const y={async mount(a){a.innerHTML=`${m({title:"WhatsApp",showBack:!0})}<div class="scroll-view" id="wa-scroll">${g()}</div>`,u(a,{onBack:()=>n.pop()});const[o,i]=await Promise.all([c("/api/mobile/v1/whatsapp/status"),c("/api/mobile/v1/whatsapp/logs?page_size=20")]),v=a.querySelector("#wa-scroll"),e=o.ok?o.data:{},l=i.ok?i.data.logs||i.data.messages||[]:[];v.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-lg)">
        ${t("whatsapp",28,"var(--whatsapp)")}
        <div style="flex:1"><div style="font-weight:var(--fw-bold)">WhatsApp Connection</div></div>
        ${r(e.connected?"Connected":"Disconnected")}
      </div>
      ${e.phone_number?d("Phone",e.phone_number):""}
      ${d("Auto Reminders",e.auto_reminders?"Enabled":"Disabled")}
      ${e.messages_sent_today!=null?d("Sent Today",String(e.messages_sent_today)):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;gap:var(--sp-sm)">
      ${e.connected?`
      <button class="btn btn-whatsapp" style="flex:1" id="wa-broadcast">${t("send",16,"white")} Broadcast</button>
      <button class="btn btn-outline" style="flex:1" id="wa-campaigns">${t("megaphone",16)} Campaigns</button>`:`<button class="btn btn-whatsapp btn-lg btn-full" id="wa-connect">${t("whatsapp",18,"white")} Connect WhatsApp</button>`}
    </div>
    ${l.length>0?`${b("Recent Messages")}
      <div class="card" style="margin:0 var(--sp-lg)">${l.slice(0,15).map(s=>`
        <div class="list-item"><div class="list-item-content">
          <div class="list-item-title">${p(s.member_name||s.phone||"Unknown")}</div>
          <div class="list-item-subtitle truncate">${p(s.template||s.message_type||"Message")}</div>
        </div><div class="list-item-right">
          <span style="font-size:var(--fs-xs);color:var(--muted)">${h(s.sent_at||s.created_at)}</span>
          ${r(s.status||"sent")}
        </div></div>`).join("")}</div>`:""}
  </div>`,a.querySelector("#wa-connect")?.addEventListener("click",()=>n.push("whatsapp-setup")),a.querySelector("#wa-broadcast")?.addEventListener("click",()=>n.push("campaign-create")),a.querySelector("#wa-campaigns")?.addEventListener("click",()=>n.push("campaigns"))}};export{y as default};
