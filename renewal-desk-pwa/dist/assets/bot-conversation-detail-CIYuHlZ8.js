import{a as v,i as b,b as p,f as r,g as c,F as u,s as m,n as g}from"./index-j0NdRznF.js";const f={async mount(t,d){const i=d?.conversationId;t.innerHTML=`${v({title:"Conversation",showBack:!0})}<div class="scroll-view" id="bcd-scroll"><div class="full-loader"><div class="spinner"></div></div></div>
    <div style="padding:var(--sp-sm) var(--sp-lg) calc(var(--sp-sm)+var(--safe-bottom));background:var(--card);border-top:1px solid var(--border);display:flex;gap:var(--sp-sm)">
      <input class="form-input" id="bcd-input" placeholder="Type a reply..." style="flex:1;min-height:40px">
      <button class="btn btn-primary btn-icon" id="bcd-send">${b("send",18,"white")}</button>
    </div>`,p(t,{onBack:()=>g.pop()});const n=await r(`/api/mobile/v1/bot/conversations/${i}`),e=t.querySelector("#bcd-scroll");if(!n.ok){e.innerHTML='<div class="empty-state"><div class="empty-state-title">Not found</div></div>';return}const l=n.data.messages||[];e.innerHTML=`<div class="chat-container">${l.map(s=>`
    <div class="chat-bubble ${s.sender==="bot"?"bot":s.sender==="customer"?"incoming":"outgoing"}">
      ${c(s.body||"")}
      <div class="chat-bubble-time">${u(s.created_at)}</div>
    </div>`).join("")}</div>`,e.scrollTop=e.scrollHeight,t.querySelector("#bcd-send")?.addEventListener("click",async()=>{const s=t.querySelector("#bcd-input"),o=s.value.trim();if(!o)return;s.value="";const a=await r(`/api/mobile/v1/bot/conversations/${i}/message`,{method:"POST",body:{body:o}});m(a.ok?"Sent!":a.error.message,a.ok?"success":"error"),a.ok&&(e.querySelector(".chat-container").insertAdjacentHTML("beforeend",`<div class="chat-bubble outgoing">${c(o)}<div class="chat-bubble-time">Just now</div></div>`),e.scrollTop=e.scrollHeight)})}};export{f as default};
