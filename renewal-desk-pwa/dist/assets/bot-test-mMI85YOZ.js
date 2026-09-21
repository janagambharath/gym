import{a as i,e as l,i as c,b as d,n as p,k as b}from"./index-BcPSQxV-.js";const v={mount(e){let o=[{role:"bot",text:"Hello! I'm your AI receptionist. How can I help you today?"}];const a=()=>{e.innerHTML=`${i({title:"Test Bot",showBack:!0})}
      <div class="scroll-view" id="bt-scroll"><div class="chat-container" id="bt-chat">
        ${o.map(t=>`<div class="chat-bubble ${t.role==="bot"?"bot":"outgoing"}">${l(t.text)}</div>`).join("")}
      </div></div>
      <div style="padding:var(--sp-sm) var(--sp-lg) calc(var(--sp-sm)+var(--safe-bottom));background:var(--card);border-top:1px solid var(--border);display:flex;gap:var(--sp-sm)">
        <input class="form-input" id="bt-input" placeholder="Type a test message..." style="flex:1;min-height:40px">
        <button class="btn btn-primary btn-icon" id="bt-send">${c("send",18,"white")}</button>
      </div>`,d(e,{onBack:()=>p.pop()});const s=e.querySelector("#bt-scroll");s.scrollTop=s.scrollHeight,e.querySelector("#bt-send").addEventListener("click",n),e.querySelector("#bt-input").addEventListener("keydown",t=>{t.key==="Enter"&&n()})};async function n(){const s=e.querySelector("#bt-input"),t=s.value.trim();if(!t)return;s.value="",o.push({role:"user",text:t}),a();const r=await b("/api/mobile/v1/bot/test",{method:"POST",body:{message:t}});r.ok&&r.data.response?o.push({role:"bot",text:r.data.response}):o.push({role:"bot",text:"Sorry, I couldn't process that. Please try again."}),a()}a()}};export{v as default};
