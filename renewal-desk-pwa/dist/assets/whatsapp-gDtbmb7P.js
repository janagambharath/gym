import{a as h,x as w,b as $,n as i,e as u,z as f,i as r,H as y,P as o,f as c,D as k,w as _}from"./index-CIkiyrdY.js";const E={async mount(e){await l(e)}};async function l(e){e.innerHTML=`${h({title:"WhatsApp",showBack:!0})}<div class="scroll-view" id="wa-scroll">${w()}</div>`,$(e,{onBack:()=>i.pop()});const[d,a]=await Promise.all([u("/api/mobile/v1/whatsapp/status"),u("/api/mobile/v1/whatsapp/logs?page_size=20")]),n=e.querySelector("#wa-scroll");if(!n)return;if(!d.ok){n.innerHTML=f(d.error?.message||"Could not load the WhatsApp status."),n.querySelector("#retry-btn")?.addEventListener("click",()=>l(e));return}const s=d.data,p=s.checklist||{},v=s.state==="CONNECTED"||p.messaging_ready===!0,b=p.reminders_ready===!0,m=s.business_phone_number||s.phone_number,g=a.ok?a.data.logs||a.data.messages||[]:[];n.innerHTML=`<div class="scroll-content">
    <div style="padding:var(--sp-lg)"><div class="card card-body">
      <div style="display:flex;align-items:center;gap:var(--sp-md);margin-bottom:var(--sp-lg)">
        ${r("whatsapp",28,"var(--whatsapp)")}
        <div style="flex:1"><div style="font-weight:var(--fw-bold)">WhatsApp Connection</div></div>
        ${y(v?"Connected":"Disconnected")}
      </div>
      ${m?o("Phone",m):""}
      ${o("Auto Reminders",b?"Enabled":"Disabled")}
      ${s.messages_sent_today!=null?o("Sent Today",String(s.messages_sent_today)):""}
    </div></div>
    <div style="padding:0 var(--sp-lg) var(--sp-lg);display:flex;gap:var(--sp-sm)">
      ${v?`
      <button class="btn btn-whatsapp" style="flex:1" id="wa-broadcast">${r("send",16,"white")} Broadcast</button>
      <button class="btn btn-outline" style="flex:1" id="wa-campaigns">${r("megaphone",16)} Campaigns</button>`:`<button class="btn btn-whatsapp btn-lg btn-full" id="wa-connect">${r("whatsapp",18,"white")} Connect WhatsApp</button>`}
    </div>
    ${a.ok?"":`<div style="padding:0 var(--sp-lg) var(--sp-lg)"><div class="empty-state" style="padding:var(--sp-md)"><div class="empty-state-text">Could not load recent messages (${c(a.error?.message||"check your connection")}).</div><button class="btn btn-primary" id="wa-logs-retry">Try Again</button></div></div>`}
    ${g.length>0?`${k("Recent Messages")}
      <div class="card" style="margin:0 var(--sp-lg)">${g.slice(0,15).map(t=>`
        <div class="list-item"><div class="list-item-content">
          <div class="list-item-title">${c(t.member_name||t.phone||"Unknown")}</div>
          <div class="list-item-subtitle truncate">${c(t.template||t.message_type||"Message")}</div>
        </div><div class="list-item-right">
          <span style="font-size:var(--fs-xs);color:var(--muted)">${_(t.sent_at||t.created_at)}</span>
          ${y(t.status||"sent")}
        </div></div>`).join("")}</div>`:""}
  </div>`,e.querySelector("#wa-connect")?.addEventListener("click",()=>i.push("whatsapp-setup")),e.querySelector("#wa-broadcast")?.addEventListener("click",()=>i.push("campaign-create")),e.querySelector("#wa-campaigns")?.addEventListener("click",()=>i.push("campaigns")),e.querySelector("#wa-logs-retry")?.addEventListener("click",()=>l(e))}export{E as default};
