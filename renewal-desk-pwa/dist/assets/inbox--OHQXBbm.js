import{a as o,q as l,b as c,f as m,v,B as p,g as d,O as b,n as i}from"./index-B7TN3ch4.js";const f={async mount(s){s.innerHTML=`${o({title:"Inbox",showBack:!0})}<div class="scroll-view" id="ib-list">${l()}</div>`,c(s,{onBack:()=>i.pop()});const n=await m("/api/mobile/v1/inbox"),r=s.querySelector("#ib-list"),a=n.ok?n.data.messages||n.data||[]:[];if(!Array.isArray(a)||a.length===0){r.innerHTML=v({icon:"inbox",title:"Inbox empty",text:"No messages yet"});return}r.innerHTML=`<div class="scroll-content"><div class="card" style="margin:var(--sp-lg)">${a.map((e,t)=>`
    <div class="list-item" data-idx="${t}" style="cursor:pointer">
      ${p(e.sender_name||e.from||"?")}
      <div class="list-item-content">
        <div class="list-item-title">${d(e.sender_name||e.from||"Unknown")}</div>
        <div class="list-item-subtitle truncate">${d(e.preview||e.text||e.message||"")}</div>
      </div>
      <span style="font-size:var(--fs-xs);color:var(--muted)">${b(e.created_at)}</span>
    </div>`).join("")}</div></div>`,r.querySelectorAll("[data-idx]").forEach(e=>{e.addEventListener("click",()=>{const t=a[Number(e.dataset.idx)];t&&(t.conversation_id?i.push("bot-conversation-detail",{conversationId:String(t.conversation_id)}):t.member_id?i.push("member-detail",{memberId:String(t.member_id)}):t.payment_id?i.push("payment-detail",{paymentId:String(t.payment_id)}):t.lead_id&&i.push("bot-lead-detail",{leadId:String(t.lead_id)}))})})}};export{f as default};
