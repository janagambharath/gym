import{a as m,z as g,b as u,k as r,i,D as c,I as n,w as b,e as p,N as w,n as d}from"./index-BNW__y8c.js";const y={async mount(a){a.innerHTML=`${m({title:"WhatsApp",showBack:!0})}<div class="scroll-view" id="wa-scroll">${g()}</div>`,u(a,{onBack:()=>d.pop()});const[o,t]=await Promise.all([r("/api/mobile/v1/whatsapp/status"),r("/api/mobile/v1/whatsapp/logs?page_size=20")]),v=a.querySelector("#wa-scroll"),e=o.ok?o.data:{},l=t.ok?t.data.logs||t.data.messages||[]:[];v.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-lg)">
        ${i("whatsapp",28,"var(--whatsapp)")}
        <div style="flex:1"><div style="font-weight:var(--fw-bold)">WhatsApp Connection</div></div>
        ${c(e.connected?"Connected":"Disconnected")}
      </div>
      ${e.phone_number?n("Phone",e.phone_number):""}
      ${n("Auto Reminders",e.auto_reminders?"Enabled":"Disabled")}
      ${e.messages_sent_today!=null?n("Sent Today",String(e.messages_sent_today)):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;gap:var(--sp-sm)">
      <button class="btn btn-whatsapp" style="flex:1" id="wa-broadcast">${i("send",16,"white")} Broadcast</button>
      <button class="btn btn-outline" style="flex:1" id="wa-campaigns">${i("megaphone",16)} Campaigns</button>
    </div>
    ${l.length>0?`${b("Recent Messages")}
      <div class="card" style="margin:0 var(--sp-lg)">${l.slice(0,15).map(s=>`
        <div class="list-item"><div class="list-item-content">
          <div class="list-item-title">${p(s.member_name||s.phone||"Unknown")}</div>
          <div class="list-item-subtitle truncate">${p(s.template||s.message_type||"Message")}</div>
        </div><div class="list-item-right">
          <span style="font-size:var(--fs-xs);color:var(--muted)">${w(s.sent_at||s.created_at)}</span>
          ${c(s.status||"sent")}
        </div></div>`).join("")}</div>`:""}
  </div>`,a.querySelector("#wa-broadcast")?.addEventListener("click",()=>d.push("campaign-create")),a.querySelector("#wa-campaigns")?.addEventListener("click",()=>d.push("campaigns"))}};export{y as default};
