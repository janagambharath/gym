import{a as h,q as w,b as y,f as v,i as a,C as m,I as d,y as $,g,F as f,n}from"./index-C2gfj6pe.js";const k={async mount(e){e.innerHTML=`${h({title:"WhatsApp",showBack:!0})}<div class="scroll-view" id="wa-scroll">${w()}</div>`,y(e,{onBack:()=>n.pop()});const[o,i]=await Promise.all([v("/api/mobile/v1/whatsapp/status"),v("/api/mobile/v1/whatsapp/logs?page_size=20")]),u=e.querySelector("#wa-scroll"),t=o.ok?o.data:{},c=t.checklist||{},r=t.state==="CONNECTED"||c.messaging_ready===!0,b=c.reminders_ready===!0,l=t.business_phone_number||t.phone_number,p=i.ok?i.data.logs||i.data.messages||[]:[];u.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-lg)">
        ${a("whatsapp",28,"var(--whatsapp)")}
        <div style="flex:1"><div style="font-weight:var(--fw-bold)">WhatsApp Connection</div></div>
        ${m(r?"Connected":"Disconnected")}
      </div>
      ${l?d("Phone",l):""}
      ${d("Auto Reminders",b?"Enabled":"Disabled")}
      ${t.messages_sent_today!=null?d("Sent Today",String(t.messages_sent_today)):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;gap:var(--sp-sm)">
      ${r?`
      <button class="btn btn-whatsapp" style="flex:1" id="wa-broadcast">${a("send",16,"white")} Broadcast</button>
      <button class="btn btn-outline" style="flex:1" id="wa-campaigns">${a("megaphone",16)} Campaigns</button>`:`<button class="btn btn-whatsapp btn-lg btn-full" id="wa-connect">${a("whatsapp",18,"white")} Connect WhatsApp</button>`}
    </div>
    ${p.length>0?`${$("Recent Messages")}
      <div class="card" style="margin:0 var(--sp-lg)">${p.slice(0,15).map(s=>`
        <div class="list-item"><div class="list-item-content">
          <div class="list-item-title">${g(s.member_name||s.phone||"Unknown")}</div>
          <div class="list-item-subtitle truncate">${g(s.template||s.message_type||"Message")}</div>
        </div><div class="list-item-right">
          <span style="font-size:var(--fs-xs);color:var(--muted)">${f(s.sent_at||s.created_at)}</span>
          ${m(s.status||"sent")}
        </div></div>`).join("")}</div>`:""}
  </div>`,e.querySelector("#wa-connect")?.addEventListener("click",()=>n.push("whatsapp-setup")),e.querySelector("#wa-broadcast")?.addEventListener("click",()=>n.push("campaign-create")),e.querySelector("#wa-campaigns")?.addEventListener("click",()=>n.push("campaigns"))}};export{k as default};
