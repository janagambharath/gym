import{a as v,i as b,b as p,k as n,e as c,N as u,s as m,n as g}from"./index-D6Fm9ZNQ.js";const f={async mount(s,d){const i=d?.conversationId;s.innerHTML=`${v({title:"Conversation",showBack:!0})}<div class="scroll-view" id="bcd-scroll"><div class="full-loader"><div class="spinner"></div></div></div>
    <div style="padding:var(--sp-sm) var(--sp-lg) calc(var(--sp-sm)+var(--safe-bottom));background:var(--card);border-top:1px solid var(--border);display:flex;gap:var(--sp-sm)">
      <input class="form-input" id="bcd-input" placeholder="Type a reply..." style="flex:1;min-height:40px">
      <button class="btn btn-primary btn-icon" id="bcd-send">${b("send",18,"white")}</button>
    </div>`,p(s,{onBack:()=>g.pop()});const r=await n(`/api/mobile/v1/bot/conversations/${i}`),t=s.querySelector("#bcd-scroll");if(!r.ok){t.innerHTML='<div class="empty-state"><div class="empty-state-title">Not found</div></div>';return}const l=r.data.messages||[];t.innerHTML=`<div class="chat-container">${l.map(e=>`
    <div class="chat-bubble ${e.role==="bot"?"bot":e.role==="customer"||e.role==="user"?"incoming":"outgoing"}">
      ${c(e.content||e.text||"")}
      <div class="chat-bubble-time">${u(e.timestamp||e.created_at)}</div>
    </div>`).join("")}</div>`,t.scrollTop=t.scrollHeight,s.querySelector("#bcd-send")?.addEventListener("click",async()=>{const e=s.querySelector("#bcd-input"),o=e.value.trim();if(!o)return;e.value="";const a=await n(`/api/mobile/v1/bot/conversations/${i}/reply`,{method:"POST",body:{message:o}});m(a.ok?"Sent!":a.error.message,a.ok?"success":"error"),a.ok&&(t.querySelector(".chat-container").insertAdjacentHTML("beforeend",`<div class="chat-bubble outgoing">${c(o)}<div class="chat-bubble-time">Just now</div></div>`),t.scrollTop=t.scrollHeight)})}};export{f as default};
